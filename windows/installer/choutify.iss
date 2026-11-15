; Installateur Windows de Choutify (Inno Setup 6).
; Compilé par GitHub Actions : iscc /DAppVersion=1.2.3 /DBuildDir=... choutify.iss
; Installation pour l'utilisateur courant uniquement : pas besoin des droits
; administrateur, ce qui permet aussi les mises à jour en un clic depuis l'app.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef BuildDir
  #define BuildDir "..\..\build\windows\x64\runner\Release"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\dist"
#endif

[Setup]
AppId={{6C1F3E2A-8B4D-4F7A-9C2E-5D3B1A7E9F40}
AppName=Choutify
AppVersion={#AppVersion}
AppVerName=Choutify {#AppVersion}
AppPublisher=Choutify
AppPublisherURL=https://github.com/BaptistaAlain/Choutify
AppSupportURL=https://github.com/BaptistaAlain/Choutify/issues
AppUpdatesURL=https://github.com/BaptistaAlain/Choutify/releases
VersionInfoVersion={#AppVersion}
DefaultDirName={localappdata}\Programs\Choutify
DefaultGroupName=Choutify
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=Choutify-{#AppVersion}-windows-setup
SetupIconFile=..\runner\resources\app_icon.ico
UninstallDisplayIcon={app}\choutify.exe
UninstallDisplayName=Choutify
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=force
RestartApplications=no

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[InstallDelete]
; Retire les ressources d'une version précédente avant de copier les nouvelles.
Type: filesandordirs; Name: "{app}\data"

[Files]
Source: "{#BuildDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Choutify"; Filename: "{app}\choutify.exe"
Name: "{autodesktop}\Choutify"; Filename: "{app}\choutify.exe"; Tasks: desktopicon

[Run]
; Installation normale : case « Lancer Choutify » à la fin.
Filename: "{app}\choutify.exe"; Description: "{cm:LaunchProgram,Choutify}"; Flags: nowait postinstall skipifsilent
; Mise à jour lancée depuis l'app (mode silencieux) : on relance Choutify.
Filename: "{app}\choutify.exe"; Flags: nowait; Check: WizardSilent
