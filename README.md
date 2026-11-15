# Choutify

Lecteur de musique **local** pour Android, iOS et Windows : tu pointes l'application vers ton dossier de musique, elle construit ta bibliothèque (artistes, albums, titres, genres, dossiers) et affiche les pochettes qu'elle trouve. Pas de compte, pas d'abonnement, pas besoin d'internet.

## Fonctionnalités

- **Bibliothèque** construite à partir d'un ou plusieurs dossiers : titres, albums, artistes, dossiers, genres, avec tris.
- **Pochettes** : image intégrée au fichier (ID3 `APIC`, FLAC `PICTURE`) ou image du dossier (`cover.jpg`, `folder.jpg`, `front.png`…).
- **Métadonnées** lues en Dart pur : ID3v2.2/2.3/2.4, ID3v1, FLAC/Vorbis. À défaut de tags, le titre et l'artiste sont déduits du nom de fichier (`01 - Artiste - Titre.mp3`).
- Formats lus : MP3, FLAC, M4A/AAC, OGG/Opus, WAV.
- **Lecteur** plein écran avec couleurs tirées de la pochette, mini-lecteur, gestes (glisser pour changer de titre ou fermer).
- **Aléatoire**, **répétition** (tout / un titre), **file d'attente** modifiable (« Lire ensuite », ajout, réorganisation, suppression).
- **Lecture en arrière-plan** avec contrôles sur l'écran de verrouillage, dans la notification, et via casque/Bluetooth (sur Windows : touches multimédia du clavier).
- **Playlists** (création, renommage, réorganisation) et **Titres aimés**.
- **Recherche** instantanée insensible aux accents dans les titres, artistes, albums et playlists.
- **Accueil** : écoutés récemment, ajoutés récemment, titres les plus écoutés, artistes favoris, albums à redécouvrir, lecture aléatoire de toute la bibliothèque.
- **Minuterie de mise en veille**.
- Reprise de la lecture là où tu t'étais arrêté.
- **Synchronisation** (Windows ↔ app web iPhone) des playlists, titres aimés et statistiques d'écoute via Google Drive : voir [`web/README.md`](web/README.md#synchroniser-avec-lapp-windows).
- **Mises à jour** : l'application vérifie les GitHub Releases et propose de télécharger la nouvelle version.

## Version web pour iPhone (Google Drive)

Une version web, installable depuis Safari sur l'écran d'accueil, lit la musique directement depuis un dossier **Google Drive** sans la stocker sur le téléphone. Elle ne nécessite ni compte Apple Developer ni AltStore et se met à jour toute seule : **https://baptistaalain.github.io/Choutify/**

Installation, connexion à Google Drive et limites : voir [`web/README.md`](web/README.md).

## Installation

Télécharge la dernière version dans les [Releases](https://github.com/BaptistaAlain/Choutify/releases/latest).

- **Android** : `Choutify-x.y.z-universal.apk` (ou la variante `arm64-v8a`, plus légère, pour la plupart des téléphones récents). Les mises à jour s'installent par-dessus la version précédente.
- **iOS** : `Choutify-x.y.z-ios-non-signe.ipa`, à installer avec AltStore ou Sideloadly. Pour une distribution via TestFlight, il faut un compte Apple Developer (voir plus bas).
- **Windows** (10 et 11, 64 bits) : `Choutify-x.y.z-windows-setup.exe`. L'installation se fait pour ton compte uniquement, sans droits administrateur, avec un raccourci dans le menu Démarrer. Les mises à jour suivantes s'installent en un clic depuis l'application. `Choutify-x.y.z-windows-portable.zip` est une version sans installation (dézipper puis lancer `choutify.exe`).

> **Avertissement SmartScreen** : l'installateur n'est pas signé (un certificat de signature de code est payant). Au premier lancement, Windows peut afficher « Windows a protégé votre ordinateur » : clique sur **Informations complémentaires** puis **Exécuter quand même**. Ton navigateur peut aussi demander de confirmer le téléchargement.

### Où mettre sa musique

- **Android** : au premier lancement, choisis ton dossier de musique (par exemple `Music`). Tu peux en ajouter d'autres dans les paramètres. Si une carte SD ou un dossier particulier n'est pas lu, active « Accès complet aux fichiers » dans les paramètres.
- **iOS** : copie ta musique dans l'app Fichiers › Sur mon iPhone › Choutify › Musique, ou utilise « Importer un dossier ».
- **Windows** : au premier lancement, choisis ton dossier de musique ou utilise directement ton dossier « Musique ». Pour écouter ta musique **Google Drive**, installe [Google Drive pour ordinateur](https://www.google.com/drive/download/) (gratuit) : ton Drive apparaît comme un lecteur (`G:\Mon Drive`). Fais un clic droit sur ton dossier de musique › *Accès hors connexion* › *Disponible hors connexion*, puis ajoute ce dossier dans Choutify. Sans cette option, l'analyse de la bibliothèque téléchargerait chaque fichier à la volée et serait très lente.

## Publier une nouvelle version

1. Augmente `version:` dans `pubspec.yaml` (par exemple `1.0.0+1` → `1.1.0+2`).
2. Pousse sur `main`.

Le workflow [`release.yml`](.github/workflows/release.yml) détecte la nouvelle version, lance l'analyse et les tests, compile l'APK Android signé, l'IPA iOS non signée et l'installateur Windows, puis crée la release `vX.Y.Z` avec les fichiers. Il peut aussi être lancé à la main depuis l'onglet Actions. Le workflow [`ci.yml`](.github/workflows/ci.yml) vérifie chaque branche et pull request et fournit un APK et un installateur Windows de test en artefacts.

### Secrets nécessaires

Dans *Settings › Secrets and variables › Actions* :

| Secret | Contenu |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | le keystore de signature encodé en base64 (`base64 -w0 choutify-release.jks`) |
| `ANDROID_KEYSTORE_PASSWORD` | son mot de passe (alias de la clé : `choutify`) |

Garde le keystore en lieu sûr : toutes les versions doivent être signées avec la même clé pour pouvoir se mettre à jour.

### iOS signé (optionnel)

Une distribution iOS signée (TestFlight ou App Store) nécessite un compte Apple Developer payant, un certificat de distribution et un profil de provisionnement. Le workflow pourra être étendu avec ces secrets.

## Développement

```bash
flutter pub get
flutter analyze
flutter test
flutter run
```

Structure :

- `lib/services/tag_reader.dart` : lecture des tags et de la durée (sans dépendance native).
- `lib/services/library_scanner.dart` : analyse incrémentale des dossiers dans un isolate.
- `lib/services/sync_core.dart` et `sync_service.dart` : synchronisation avec l'app web via le dossier `Choutify-synchro` (même format et même fusion que `web/src/lib/synccore.ts`, vérifié par `test/fixtures/sync_scenario.json`).
- `lib/state/` : état de la bibliothèque (playlists, favoris, statistiques) et du lecteur (`just_audio` + `just_audio_background`).
- `lib/screens/` : écrans de l'application.
- `windows/` : application Windows (fenêtre, icône) et `windows/installer/choutify.iss`, le script Inno Setup de l'installateur. Sur Windows, la lecture passe par `just_audio_windows` (lecteur multimédia de Windows) ; `just_audio_background` n'est utilisé que sur Android et iOS.
