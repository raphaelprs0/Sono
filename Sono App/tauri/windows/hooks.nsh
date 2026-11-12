; Désinstallation de Sono sur Windows : toutes les données de Sono sont supprimées avec l’app,
; sauf pendant une mise à jour. Deux cas de mise à jour :
; - mise à jour automatique : le désinstalleur de l’ancienne version est lancé avec /UPDATE ;
; - nouvel installateur lancé par-dessus l’ancienne version : il lance l’ancien désinstalleur directement
;   depuis le dossier de l’app ($EXEDIR = $INSTDIR). Une vraie désinstallation (Paramètres de Windows)
;   passe toujours par une copie temporaire du désinstalleur, hors du dossier de l’app.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
  ${AndIf} $EXEDIR != $INSTDIR
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
