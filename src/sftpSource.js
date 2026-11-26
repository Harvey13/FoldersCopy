const path = require('path').posix;
const fs = require('fs');
const fsPromises = fs.promises;
const { pipeline } = require('stream/promises');
const { Client } = require('ssh2');

function normalizeFingerprint(value) {
    return String(value || '').replace(/^SHA256:/i, '').trim().toLowerCase();
}

function isDirectory(attrs) {
    if (typeof attrs.isDirectory === 'function') return attrs.isDirectory();
    return (Number(attrs.mode) & 0o170000) === 0o040000;
}

function isSymbolicLink(attrs) {
    return (Number(attrs.mode) & 0o170000) === 0o120000;
}

class SftpSource {
    constructor(options) {
        this.options = options;
        this.connection = new Client();
        this.sftp = null;
        this.hostFingerprint = null;
        this.closed = false;
    }

    static async connect(options) {
        const source = new SftpSource(options);
        await source.open();
        return source;
    }

    // Obtain the host key fingerprint without sending the SFTP password.
    static async getHostFingerprint(options) {
        const { host, port = 2222 } = options || {};
        if (!host) throw new Error('Adresse IP du téléphone manquante.');
        const connection = new Client();
        return new Promise((resolve, reject) => {
            let fingerprint = null;
            let settled = false;
            const finish = (error) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                connection.end();
                if (fingerprint) resolve(fingerprint);
                else reject(error || new Error('Impossible de lire la clé SSH du téléphone.'));
            };
            const timeout = setTimeout(() => finish(new Error('Délai dépassé lors de la lecture de la clé SSH.')), 16000);
            connection.once('error', finish);
            connection.once('close', () => finish(new Error('Connexion fermée pendant la lecture de la clé SSH.')));
            connection.connect({
                host,
                port: Number(port),
                username: 'fingerprint-check',
                password: 'fingerprint-check',
                readyTimeout: 15000,
                hostHash: 'sha256',
                hostVerifier: (hash) => {
                    fingerprint = hash;
                    return false;
                }
            });
        });
    }

    async open() {
        const { host, port = 2222, username, password, hostKeyFingerprint } = this.options || {};
        if (!host || !username || !password) {
            throw new Error('Configuration SFTP incomplète : adresse, utilisateur et mot de passe requis.');
        }

        if (!hostKeyFingerprint) throw new Error('Empreinte de clé SSH absente : utilise d’abord « Parcourir » pour vérifier le téléphone.');

        const numericPort = Number(port);
        if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
            throw new Error('Port SFTP invalide.');
        }

        await new Promise((resolve, reject) => {
            let settled = false;
            const fail = (error) => {
                if (settled) return;
                settled = true;
                reject(error);
            };

            this.connection.once('ready', () => {
                this.connection.sftp((error, sftp) => {
                    if (error) return fail(error);
                    if (settled) return;
                    settled = true;
                    this.sftp = sftp;
                    resolve();
                });
            });

            this.connection.once('error', fail);
            this.connection.connect({
                host,
                port: numericPort,
                username,
                password,
                readyTimeout: 15000,
                keepaliveInterval: 10000,
                keepaliveCountMax: 3,
                hostHash: 'sha256',
                hostVerifier: (fingerprint) => {
                    this.hostFingerprint = fingerprint;
                    const expected = normalizeFingerprint(hostKeyFingerprint);
                    return !!expected && expected === normalizeFingerprint(fingerprint);
                }
            });
        }).catch((error) => {
            this.connection.end();
            if (/host key/i.test(error.message)) {
                throw new Error('La clé SSH du téléphone a changé. Vérifie le serveur avant de faire confiance à cette nouvelle clé.');
            }
            throw new Error(`Connexion SFTP impossible : ${error.message}`);
        });
    }

    async listDirectory(remoteDirectory) {
        const remotePath = path.normalize('/' + String(remoteDirectory || '/').replace(/^\/+/, ''));
        return new Promise((resolve, reject) => {
            this.sftp.readdir(remotePath, (error, entries) => {
                if (error) return reject(new Error(`Lecture SFTP impossible (${remotePath}) : ${error.message}`));
                const result = entries
                    .filter((entry) => entry.filename !== '.' && entry.filename !== '..')
                    .map((entry) => ({
                        name: entry.filename,
                        path: path.join(remotePath, entry.filename),
                        isDirectory: isDirectory(entry.attrs),
                        isSymbolicLink: isSymbolicLink(entry.attrs),
                        size: Number(entry.attrs.size || 0),
                        mtime: new Date(Number(entry.attrs.mtime || 0) * 1000)
                    }))
                    .sort((a, b) => {
                        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
                        return a.name.localeCompare(b.name, 'fr');
                    });
                resolve(result);
            });
        });
    }

    async download(remotePath, destinationPath) {
        if (this.closed || !this.sftp) throw new Error('La session SFTP est fermée.');
        await fsPromises.mkdir(require('path').dirname(destinationPath), { recursive: true });

        const input = this.sftp.createReadStream(remotePath);
        const output = fs.createWriteStream(destinationPath);
        try {
            await pipeline(input, output);
            return true;
        } catch (error) {
            input.destroy();
            output.destroy();
            await fsPromises.rm(destinationPath, { force: true }).catch(() => {});
            throw new Error(`Téléchargement SFTP échoué pour ${remotePath} : ${error.message}`);
        }
    }

    close() {
        if (this.closed) return;
        this.closed = true;
        try {
            if (this.sftp) this.sftp.end();
            this.connection.end();
        } catch (_) {
            // Fermeture best-effort de la session.
        }
    }
}

module.exports = { SftpSource };