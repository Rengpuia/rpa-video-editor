; RPA Video Editor - Studio Pro Cleanroom Edition
; Inno Setup 6 Installer Script
; Developer: K Vanlalrengpuia (rengakhiangte@gmail.com)
; License: Open Source (MIT License)

#define MyAppName "RPA Video Editor"
#define MyAppVersion "2.0.0"
#define MyAppPublisher "K Vanlalrengpuia"
#define MyAppURL "https://github.com/Rengpuia/rpa-video-editor"
#define MyAppContact "rengakhiangte@gmail.com"
#define MyAppExeName "RPA_Video_Editor.exe"

[Setup]
AppId={{8B3F9A12-4D3C-4C90-8E0B-1F67A8C92B45}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
AppContact={#MyAppContact}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
OutputDir=exports
OutputBaseFilename=RPA_Video_Editor_Setup_v2.0.0
SetupIconFile=client\favicon.ico
UninstallDisplayIcon={app}\client\favicon.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ChangesAssociations=yes

; In-Place Update & Upgradeable Configuration
UsePreviousAppDir=yes
DisableDirPage=auto
CloseApplications=yes
RestartApplications=no
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs restartreplace; Excludes: "node_modules\*,exports\*,*.tmp,.git\*,projects\*"

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\client\favicon.ico"; WorkingDir: "{app}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\client\favicon.ico"; WorkingDir: "{app}"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Classes\.rpavideo"; ValueType: string; ValueName: ""; ValueData: "RpaVideoProject"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\RpaVideoProject"; ValueType: string; ValueName: ""; ValueData: "RPA Video Editor Project"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\RpaVideoProject\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\client\favicon.ico,0"
Root: HKCU; Subkey: "Software\Classes\RpaVideoProject\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: postinstall nowait skipifsilent
