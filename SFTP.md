# FoldersCopy — source SFTP

La prise en charge SFTP est ajoutée sans supprimer les mappings historiques :
- `sourceType: "local"` (ou absent) conserve les dossiers Windows, y compris les lecteurs WebDAV montés ;
- `sourceType: "sftp"` lit directement le téléphone via SSH/SFTP ;
- les destinations PC et le principe de copie existants restent utilisés.

## Configurer un nouveau mapping SFTP

1. Installer et démarrer l'application Android **SftpServer** sur le téléphone.
2. Accorder l'autorisation Android « Accès à tous les fichiers ».
3. Démarrer le serveur : l'application affiche l'adresse IP, le port, l'utilisateur et un mot de passe aléatoire.
4. Dans FoldersCopy, créer ou modifier un mapping puis choisir **Téléphone (SFTP)**.
5. Renseigner l'IP, le port (2222), l'utilisateur (`backup`) et le mot de passe.
6. Cliquer sur le bouton de sélection de la source. À la première connexion, vérifier l'empreinte de clé SSH affichée et confirmer qu'elle correspond à celle du téléphone.
7. Choisir le chemin distant, puis la destination Windows et enregistrer.

Le serveur Android expose le stockage partagé sous `/`. Exemple : `/DCIM/Camera`.

## Sécurité

- Le serveur Android exige un mot de passe aléatoire généré localement.
- Le serveur SFTP Android est conçu pour la lecture seule.
- FoldersCopy mémorise l'empreinte SSH acceptée dans le mapping et la vérifie lors des connexions suivantes.
- Le mot de passe est conservé dans la configuration locale FoldersCopy ; ne partage pas ce fichier de configuration.
- L'accès SFTP doit rester limité au réseau local de confiance. Ne redirige pas le port 2222 vers Internet.

## Compatibilité

Les mappings locaux existants restent locaux. Pour revenir à WebDAV, sélectionner « Dossier Windows / WebDAV monté » dans le type de source. L'application Android WebDAV d'origine n'est pas modifiée.
