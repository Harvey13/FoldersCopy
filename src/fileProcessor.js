const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');
const { log_cli } = require('./utils/logger');
const { SftpSource } = require('./sftpSource');

let isCancelled = false;

async function directoryExists(dirPath) {
    try { return (await fs.stat(dirPath)).isDirectory(); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function getFileCount(dirPath) {
    try { return (await fs.readdir(dirPath)).length; }
    catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
}

async function listLocalFilesRecursively(rootDirectory) {
    const files = [];
    const walk = async (directory) => {
        const entries = await fs.readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name === '.picasa.ini' || entry.isSymbolicLink()) continue;
            const absolutePath = path.join(directory, entry.name);
            if (entry.isDirectory()) await walk(absolutePath);
            else if (entry.isFile()) {
                const stats = await fs.stat(absolutePath);
                files.push({ path: path.relative(rootDirectory, absolutePath), localPath: absolutePath, mtime: stats.mtime });
            }
        }
    };
    await walk(rootDirectory);
    return files;
}

async function findLatestFileDate(basePath) {
    try {
        if (!(await directoryExists(basePath))) return new Date(0);
        const baseDirectory = path.dirname(basePath);
        const baseName = path.basename(basePath);
        const entries = await fs.readdir(baseDirectory, { withFileTypes: true });
        const folders = entries.filter((entry) => entry.isDirectory() && (
            entry.name === baseName || (entry.name.startsWith(baseName + '_') && /^\\d{2}$/.test(entry.name.slice(baseName.length + 1)))
        ));
        let latest = new Date(0);
        for (const folder of folders) {
            const files = await listLocalFilesRecursively(path.join(baseDirectory, folder.name));
            for (const file of files) if (file.mtime > latest) latest = file.mtime;
        }
        return latest;
    } catch (error) {
        log_cli('ERROR', 'Erreur lors de la recherche de la date la plus récente', { path: basePath, error: error.message });
        return new Date(0);
    }
}

async function findLastExistingIndexedFolder(basePath) {
    const baseDir = path.dirname(basePath);
    const baseName = path.basename(basePath);
    let last = { path: basePath, index: 0 };
    try {
        const entries = await fs.readdir(baseDir, { withFileTypes: true });
        const folders = entries.filter((entry) => entry.isDirectory() && (
            entry.name === baseName || (entry.name.startsWith(baseName + '_') && /^\\d{2}$/.test(entry.name.slice(baseName.length + 1)))
        )).map((entry) => entry.name).sort((a, b) => b.localeCompare(a));
        for (const name of folders) {
            const index = name === baseName ? 0 : Number.parseInt(name.slice(baseName.length + 1), 10);
            if (index >= last.index) last = { path: path.join(baseDir, name), index };
        }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return last;
}

async function findNextDestination(basePath, maxFiles) {
    const last = await findLastExistingIndexedFolder(basePath);
    if ((await getFileCount(last.path)) < maxFiles) return last.path;
    for (let index = last.index + 1; index < last.index + 101; index++) {
        const candidate = `${basePath}_${String(index).padStart(2, '0')}`;
        if (!(await directoryExists(candidate))) {
            await fs.mkdir(candidate, { recursive: true });
            return candidate;
        }
        if ((await getFileCount(candidate)) < maxFiles) return candidate;
    }
    throw new Error('Impossible de créer un nouveau dossier de destination.');
}

async function copyOneFile(file, destination, mapping, onProgress) {
    const target = path.join(destination, ...file.path.split(/[\\\\/]/).filter(Boolean));
    try { await fs.access(target); return false; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (onProgress) onProgress({ status: 'copying', file: file.path, mapping: mapping.title });
    if (file.remotePath) await file.provider.download(file.remotePath, target);
    else await fs.copyFile(file.localPath, target);
    return true;
}

async function processMapping({ mapping, onProgress, onComplete }) {
    let provider = null;
    try {
        isCancelled = false;
        if (!mapping || !mapping.sourcePath || !mapping.destPath) throw new Error('Mapping invalide ou incomplet.');
        const isSftp = mapping.sourceType === 'sftp';
        if (isSftp) provider = await SftpSource.connect(mapping.sftp || {});
        else await fs.access(mapping.sourcePath);

        let config = {};
        try { config = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'config.json'), 'utf8')); } catch (_) {}
        const maxFiles = Number(config.maxFiles) > 0 ? Number(config.maxFiles) : 100;
        const latestDestinationDate = await findLatestFileDate(mapping.destPath);
        const sourceFiles = isSftp
            ? await provider.listFilesRecursively(mapping.sourcePath)
            : await listLocalFilesRecursively(mapping.sourcePath);
        const candidates = sourceFiles.filter((file) => file.mtime > latestDestinationDate);
        if (!candidates.length) {
            const result = { total: 0, processed: 0, copied: 0, cancelled: false };
            if (onComplete) onComplete(result);
            return result;
        }

        let processed = 0, copied = 0, destination = mapping.destPath;
        if (onProgress) onProgress({ status: 'start', mapping: mapping.title, current: 0, total: candidates.length });
        for (const file of candidates) {
            if (isCancelled) break;
            if ((await getFileCount(destination)) >= maxFiles) destination = await findNextDestination(mapping.destPath, maxFiles);
            try {
                file.provider = provider;
                if (await copyOneFile(file, destination, mapping, onProgress)) copied++;
            } catch (error) {
                log_cli('ERROR', 'Erreur lors de la copie du fichier', { mapping: mapping.title, file: file.path, error: error.message });
                if (onProgress) onProgress({ status: 'file-error', mapping: mapping.title, file: file.path, error: error.message });
            }
            processed++;
            if (onProgress) onProgress({ status: 'copying', mapping: mapping.title, current: processed, total: candidates.length, file: file.path });
        }
        const result = { total: candidates.length, processed, copied, cancelled: isCancelled };
        if (onComplete) onComplete(result);
        return result;
    } catch (error) {
        log_cli('ERROR', 'Erreur lors du traitement du mapping', { mapping: mapping && mapping.title, error: error.message });
        if (onComplete) onComplete({ error: error.message, cancelled: isCancelled });
        throw error;
    } finally { if (provider) provider.close(); }
}

function cancelCopy() { isCancelled = true; }
function resetCancelFlag() { isCancelled = false; }

module.exports = { processMapping, cancelCopy, resetCancelFlag, findNextDestination, directoryExists, getFileCount };