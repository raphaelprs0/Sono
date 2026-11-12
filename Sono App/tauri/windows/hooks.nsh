; Désinstallation de Sono sur Windows : toutes les données de Sono sont supprimées avec l’app,
; sauf pendant une mise à jour. Deux cas de mise à jour :
; - mise à jour automatique : le désinstalleur de l’ancienne version est lancé avec /UPDATE ;
; - nouvel installateur lancé par-dessus l’ancienne version : il lance l’ancien désinstalleur directement
;   depuis le dossier de l’app, à côté de Sono. Une vraie désinstallation (Paramètres de Windows) passe
;   toujours par une copie temporaire du désinstalleur, loin du dossier de l’app.
; La vérification se fait avant que les fichiers de l’app soient effacés.
Var SonoKeepData

!macro NSIS_HOOK_PREUNINSTALL
  StrCpy $SonoKeepData 0
  ${If} $UpdateMode = 1
    StrCpy $SonoKeepData 1
  ${EndIf}
  ${If} ${FileExists} "$EXEDIR\${MAINBINARYNAME}.exe"
  ${OrIf} ${FileExists} "$EXEDIR\bin\sono-deezer-bridge.exe"
    StrCpy $SonoKeepData 1
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $SonoKeepData <> 1
    ; Sessions, réglages, compte Deezer, journaux, connecteur du lien « Internet »
    RMDir /r "$APPDATA\Sono"
    ; Données de la fenêtre (WebView2 : cache, stockage local)
    RMDir /r "$LOCALAPPDATA\app.sono.desktop"
    RMDir /r "$APPDATA\app.sono.desktop"
    ; Réglage d’égaliseur écrit par le moteur Deezer (le dossier n’est retiré que s’il est vide)
    Delete "$APPDATA\opendeezer\eq.json"
    RMDir "$APPDATA\opendeezer"
  ${EndIf}
!macroend
