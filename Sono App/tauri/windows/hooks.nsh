; Désinstallation de Sono sur Windows : toutes les données de Sono sont supprimées avec l’app
; (sauf pendant une mise à jour, où le désinstalleur de l’ancienne version est lancé avec /UPDATE).
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    ; Sessions, réglages, compte Deezer, journaux
    RMDir /r "$APPDATA\Sono"
    ; Données de la fenêtre (WebView2 : cache, stockage local)
    RMDir /r "$LOCALAPPDATA\app.sono.desktop"
    RMDir /r "$APPDATA\app.sono.desktop"
    ; Réglage d’égaliseur écrit par le moteur Deezer (le dossier n’est retiré que s’il est vide)
    Delete "$APPDATA\opendeezer\eq.json"
    RMDir "$APPDATA\opendeezer"
  ${EndIf}
!macroend
