# IPChat

Chat d'équipe : accueil, comptes, salons, messages privés, fichiers (10 Mo), profil et réglages.
Fonctionne avec Node.js 14 ou plus récent, sans module natif (données dans `data.json`).

## 1. Tester sur ton ordinateur

```bash
npm install
TEAM_CODE=test npm start
```

Ouvre http://localhost:3000, clique sur « Commencer », puis crée un compte avec le code d'équipe (`test` ici).
Sans `TEAM_CODE`, le code par défaut est `equipe2026`.

## 2. Envoyer le projet sur GitHub

Ne mets jamais `node_modules`, `data.json` ni `uploads` sur GitHub (le fichier `.gitignore` les exclut).

**Option A, depuis le site GitHub (sans Git)**
1. Sur github.com : New repository, nomme-le `ipchat`, laisse-le vide, puis Create repository.
2. Clique sur « uploading an existing file ».
3. Glisse-y **le contenu** du dossier (`server.js`, `store.js`, `package.json`, `render.yaml`, `README.md`, et le dossier `public`), pas le dossier lui-même. Le fichier `render.yaml` doit être à la racine du dépôt.
4. Clique sur Commit changes.

**Option B, avec Git**
```bash
cd ipchat
git init
git add .
git commit -m "IPChat"
git branch -M main
git remote add origin https://github.com/TON-COMPTE/ipchat.git
git push -u origin main
```

## 3. Déployer sur Render

1. Sur render.com : New, puis **Blueprint**, puis connecte ton compte GitHub et choisis le dépôt `ipchat`.
2. Render lit `render.yaml` et te demande la valeur de `TEAM_CODE` : saisis ton code d'équipe secret.
3. Clique sur Apply. Attends la fin du déploiement (quelques minutes).
4. Ouvre l'adresse `https://ipchat-xxxx.onrender.com` affichée en haut de la page du service, puis crée ton compte.

**Sans Blueprint** : New, puis Web Service, choisis le dépôt, Build Command `npm install`, Start Command `npm start`, et dans Environment ajoute `TEAM_CODE` (et `NODE_VERSION` = `20`).

## Limites du plan gratuit

- Le service s'endort après 15 minutes sans trafic. Le premier accès suivant prend jusqu'à une minute.
- Le disque est éphémère : comptes, messages et fichiers sont perdus à chaque redémarrage, redéploiement ou mise en veille. C'est suffisant pour tester.
- Pour un usage réel : passe à un plan payant, ajoute un disque persistant (Disks dans Render, par exemple monté sur `/data`) et ajoute la variable `DATA_DIR=/data`.

## Variables d'environnement

| Variable | Rôle | Défaut |
|---|---|---|
| `TEAM_CODE` | Code demandé pour créer un compte | `equipe2026` (à changer) |
| `PORT` | Port du serveur (fourni par Render) | `3000` |
| `DATA_DIR` | Dossier de `data.json` et de `uploads/` | dossier du projet |
| `NODE_VERSION` | Version de Node sur Render | `20` (dans `render.yaml`) |

## À savoir

- Les fichiers envoyés sont servis par des adresses aléatoires, sans mot de passe : quiconque a le lien peut les ouvrir.
- Les messages privés sont limités aux deux participants dans l'application, mais ne sont pas chiffrés dans `data.json`.
- Après 10 échecs de connexion en 10 minutes, l'adresse IP est bloquée temporairement.
- « Bloquer » est local à l'appareil.

## Structure

```
server.js          serveur (Express, Socket.IO)
store.js           stockage dans data.json
render.yaml        configuration Render (Blueprint)
public/index.html  pages
public/style.css   styles
public/app.js      logique de l'interface
```
