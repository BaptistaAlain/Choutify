# Choutify web (iPhone)

Version web de Choutify, pensée pour l'iPhone : elle s'installe depuis Safari sur l'écran d'accueil, s'ouvre en plein écran comme une vraie app et se met à jour toute seule. Pas besoin de compte Apple Developer ni d'AltStore.

Elle lit la musique **directement depuis un dossier Google Drive** : rien n'est stocké sur le téléphone, sauf les titres que tu choisis de garder hors ligne.

Adresse de l'app : **https://baptistaalain.github.io/Choutify/**

## Fonctionnalités

- **Google Drive** : connexion à ton compte, choix d'un ou plusieurs dossiers (y compris « Partagés avec moi »), sous-dossiers analysés automatiquement. Seul le début de chaque fichier est lu pour récupérer titres, artistes, albums et pochettes. La bibliothèque s'actualise à l'ouverture (seuls les fichiers nouveaux ou modifiés sont relus).
- **Fichiers de l'iPhone** : import depuis l'app Fichiers (iCloud Drive, Sur mon iPhone…), lisibles hors ligne.
- **Pochettes** intégrées aux fichiers (MP3, FLAC, M4A) ou image du dossier (`cover.jpg`, `folder.jpg`, `front.png`…). Les couleurs du lecteur s'adaptent à la pochette.
- **Bibliothèque** : playlists, albums, artistes, titres, genres, avec tris.
- **Lecteur** plein écran, mini-lecteur, **aléatoire**, **répétition** (tout / un titre), **file d'attente** modifiable (lire ensuite, ajouter, réorganiser, retirer).
- **Écran verrouillé** : titre, pochette et commandes (lecture, pause, suivant, précédent, position).
- **Playlists** (création, renommage, réorganisation) et **Titres aimés**.
- **Recherche** instantanée, insensible aux accents.
- **Accueil** : écoutés récemment, titres les plus écoutés, tes artistes, ajoutés récemment, à redécouvrir.
- **Hors ligne** : télécharge un album ou une playlist pour l'écouter sans réseau. Les titres écoutés restent en cache (taille réglable).
- **Minuterie** de mise en veille et **reprise** là où tu t'étais arrêté.

## Installer sur l'iPhone

1. Ouvre **https://baptistaalain.github.io/Choutify/** dans **Safari**.
2. Touche le bouton **Partager** (carré avec une flèche), puis **Sur l'écran d'accueil**, puis **Ajouter**.
3. Lance Choutify depuis l'icône de l'écran d'accueil.

## Connecter Google Drive

Google demande que chaque application qui lit un Drive ait son propre « identifiant client ». C'est gratuit et se fait une seule fois, en 10 minutes environ. Le plus simple est de le faire sur un ordinateur, connecté au compte Google qui contient ta musique.

### 1. Créer le projet Google Cloud

1. Va sur https://console.cloud.google.com/ et accepte les conditions si c'est ta première visite.
2. En haut à gauche, clique sur le sélecteur de projet, puis **Nouveau projet**. Nom : `Choutify`. Clique sur **Créer**, puis sélectionne ce projet.
3. Ouvre https://console.cloud.google.com/apis/library/drive.googleapis.com et clique sur **Activer**.

### 2. Configurer l'écran de connexion

1. Ouvre https://console.cloud.google.com/auth/overview et clique sur **Commencer**.
2. Nom de l'application : `Choutify`. Adresse e-mail d'assistance : la tienne. **Suivant**.
3. Audience : **Externe**. **Suivant**.
4. Coordonnées : ton adresse e-mail. **Suivant**, coche l'acceptation, puis **Créer**.
5. Dans le menu de gauche, **Audience** :
   - sous « Utilisateurs test », clique sur **Add users** et ajoute ton adresse Gmail ;
   - recommandé : clique sur **Publier l'application** puis **Confirmer**. Sans cela (mode « Test »), Google te déconnecte tous les 7 jours. L'application n'a pas besoin d'être validée par Google pour ton usage personnel.

### 3. Créer l'identifiant client

1. Dans le menu de gauche, **Clients**, puis **Créer un client**.
2. Type d'application : **Application Web**. Nom : `Choutify web`.
3. **Origines JavaScript autorisées** → Ajouter un URI : `https://baptistaalain.github.io`
4. **URI de redirection autorisés** → Ajouter un URI : `https://baptistaalain.github.io/Choutify/`
   (l'app affiche aussi ces deux adresses dans Réglages, avec un bouton pour les copier)
5. Clique sur **Créer**. Google affiche l'**ID client** (se termine par `.apps.googleusercontent.com`) et le **Code secret du client** (commence par `GOCSPX-`). Copie-les tout de suite, ou télécharge le fichier JSON : le code secret n'est plus affiché ensuite.

### 4. Dans l'app

1. Ouvre Choutify sur l'iPhone, touche l'engrenage (Réglages).
2. Colle l'**ID client** et le **Code secret du client**, puis **Enregistrer et se connecter**.
3. Choisis ton compte Google. Si Google affiche « Google n'a pas validé cette application », touche **Paramètres avancés** puis **Accéder à Choutify** : c'est ton application : elle lit ta musique et n'écrit que dans son dossier « Choutify-synchro ».
4. Autorise l'accès, puis **Ajouter un dossier** et choisis le dossier où se trouve ta musique.

L'identifiant et le code secret restent sur ton iPhone : ils ne sont pas publiés dans le dépôt GitHub. Si tu préfères ne pas recopier l'ID client, tu peux le définir une fois pour toutes dans *Settings › Secrets and variables › Actions › Variables* du dépôt, sous le nom `GOOGLE_CLIENT_ID` (le code secret, lui, se saisit toujours dans l'app).

## Synchroniser avec l'app Windows

Les playlists, les titres aimés et les statistiques d'écoute (titres les plus écoutés, écoutés récemment) peuvent être partagés entre Choutify sur l'iPhone et Choutify sur ton PC Windows. Les réglages propres à chaque appareil (dossiers, cache) restent séparés.

**Sur l'iPhone** : Réglages › Google Drive › **Activer la synchronisation**. Google redemande l'autorisation, cette fois pour lire *et écrire* dans ton Drive (même avertissement « Google n'a pas validé cette application » que la première fois : **Paramètres avancés** › **Accéder à Choutify**). Choutify crée alors un dossier `Choutify-synchro` dans ton dossier de musique et y dépose un petit fichier. Il n'écrit nulle part ailleurs.

**Sur le PC** : ajoute dans Choutify le *même* dossier de musique, via Google Drive pour ordinateur (par exemple `G:\Mon Drive\Musique`). Choutify trouve le dossier `Choutify-synchro` tout seul (Paramètres › Synchronisation avec l'iPhone) et y dépose son propre fichier.

Ensuite, tout se fait automatiquement : à l'ouverture de l'app, quelques secondes après chaque modification, et toutes les quelques minutes. Il faut compter jusqu'à une minute environ pour que Google Drive pour ordinateur transmette les changements dans un sens ou dans l'autre.

Comment ça marche : chaque appareil écrit son propre fichier et lit celui des autres, et chaque playlist, titre ajouté ou retiré, favori et compteur d'écoutes y porte sa date de modification. Les modifications faites des deux côtés, même hors ligne, sont donc fusionnées sans perte : une playlist modifiée sur les deux appareils garde les ajouts de chacun. Les titres sont reconnus par leur chemin dans le dossier de musique : **un fichier déplacé ou renommé** dans le Drive sort des playlists où il était (comme avant). Les fichiers importés sur l'iPhone (hors Drive) restent dans les playlists de l'iPhone mais ne sont pas synchronisés.

## Limites sur iPhone

- **Démarrage d'un titre** : pour que la lecture continue écran verrouillé, chaque titre est téléchargé avant d'être lu (1 à 3 secondes pour un MP3 en Wi-Fi ou en 4G, davantage pour un gros FLAC). Le titre suivant est préchargé pendant l'écoute, l'enchaînement se fait donc sans coupure.
- **Arrière-plan** : la musique continue écran verrouillé et dans les autres apps. iOS peut toutefois arrêter l'app si une autre app prend la main sur le son (appel, vidéo…) : il suffit alors de relancer la lecture.
- **Pas de CarPlay ni de Siri**, réservés aux apps de l'App Store. Les commandes Bluetooth et l'écran verrouillé fonctionnent.
- **Formats** : MP3, M4A/AAC, FLAC et WAV sont lus par Safari. Les fichiers OGG/Opus peuvent ne pas être lus selon la version d'iOS.
- **Stockage** : le cache et les titres hors ligne sont gardés par iOS, mais peuvent être effacés si l'iPhone manque d'espace. Ils seront alors simplement retéléchargés.
- **Première analyse** : environ une à deux secondes pour 10 titres. Une bibliothèque de 1 000 titres prend quelques minutes, une seule fois.

## Publication

Le workflow [`web.yml`](../.github/workflows/web.yml) teste, construit et publie l'app sur GitHub Pages à chaque modification du dossier `web/` sur `main`. Pour l'activer la première fois : *Settings › Pages › Build and deployment › Source* : **GitHub Actions**.

## Développement

```bash
cd web
npm install
npm run dev      # serveur local
npm test         # tests unitaires (lecture des tags)
npm run build    # version de production dans web/dist
```

Structure :

- `src/lib/tags.ts` : lecture des tags ID3/FLAC/MP4 et de la durée, par plages d'octets (port du lecteur Dart de l'app mobile).
- `src/lib/google.ts` : connexion Google (OAuth 2.0 avec PKCE et jeton de renouvellement) et API Drive.
- `src/lib/library.ts` : analyse des dossiers, bibliothèque, playlists, favoris, statistiques (IndexedDB).
- `src/lib/player.ts` : lecteur, file d'attente, Media Session, minuterie, reprise.
- `src/lib/audiocache.ts` : cache audio et hors ligne (Cache Storage).
- `public/sw.js` : service worker (fonctionnement hors ligne de l'app et mises à jour).
