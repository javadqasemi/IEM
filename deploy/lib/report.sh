# shellcheck shell=bash
#
# The closing summary, on screen and as a file.
#
# The password is deliberately not repeated. The operator chose it or supplied
# it, they have it, and printing it again would put it into terminal
# scrollback, screen recordings and shoulder-view for no benefit.

report::write() {
  local scheme="http" report_file="$CONFIG_DIR/installation-report.txt"
  [[ "${SSL_ACTIVE:-0}" == "1" ]] && scheme="https"

  local status_line status_colour
  if (( CHECKS_FAILED > 0 )); then
    status_line="Installation abgeschlossen — mit ${CHECKS_FAILED} Problem(en)"
    status_colour="$C_YELLOW"
  else
    status_line="Installation abgeschlossen"
    status_colour="$C_GREEN"
  fi

  printf '\n%s%s%s\n' "$C_BOLD$status_colour" "════════════════════════════════════════════════════════════" "$C_RESET"
  printf '%s  %s%s\n' "$C_BOLD$status_colour" "$status_line" "$C_RESET"
  printf '%s%s%s\n\n' "$C_BOLD$status_colour" "════════════════════════════════════════════════════════════" "$C_RESET"

  cat <<EOF
  ${C_BOLD}Adressen${C_RESET}
    Website        ${scheme}://${CFG_DOMAIN}
    Dashboard      ${scheme}://${CFG_DOMAIN}/admin.html
    API            ${scheme}://${CFG_DOMAIN}/api/v1

  ${C_BOLD}Anmeldung${C_RESET}
    Benutzer       ${CFG_ADMIN_EMAIL}
    Passwort       ${C_DIM}(das bei der Installation gewählte — wird nicht erneut angezeigt)${C_RESET}
    Rolle          Super Admin — volle Rechte, einziger mit Veröffentlichungsrecht

  ${C_BOLD}Zustand${C_RESET}
    Prüfungen      ${CHECKS_PASSED} bestanden, ${CHECKS_WARNED} Hinweis(e), ${CHECKS_FAILED} Fehler
    Dienste        PostgreSQL, Redis, Nginx, API (PM2)
    HTTPS          $([[ "${SSL_ACTIVE:-0}" == "1" ]] && echo "aktiv${SSL_EXPIRY:+, gültig bis $SSL_EXPIRY}" || echo "nicht aktiv")
    Sicherungen    täglich 02:15 · wöchentlich So · monatlich am 1.
    Firewall       $(ufw status 2>/dev/null | grep -q "Status: active" && echo "aktiv" || echo "inaktiv")
    Aktualisierung iem update

  ${C_BOLD}Verwaltung${C_RESET}
    iem status                Zustand aller Dienste
    iem health                Vollständige Prüfung erneut ausführen
    iem logs                  Protokolle der API verfolgen
    iem backup                Sicherung jetzt erstellen
    iem restore <datei>       Sicherung einspielen
    iem update                Anwendung aktualisieren (mit Sicherung und Rollback)
    iem restart               API neu starten

  ${C_BOLD}Dateien${C_RESET}
    Anwendung      ${APP_DIR}
    Daten          ${DATA_DIR}
    Protokolle     ${LOG_DIR}
    Sicherungen    ${BACKUP_DIR}
    Zugangsdaten   ${CRED_FILE} ${C_DIM}(nur root — unbedingt mitsichern)${C_RESET}
    Protokoll      ${LOG_FILE}
    Dieser Bericht ${report_file}

EOF

  report::open_points
  report::to_file "$report_file" "$scheme"

  if (( CHECKS_FAILED > 0 )); then
    printf '  %sNicht bestandene Prüfungen:%s\n' "$C_BOLD$C_RED" "$C_RESET"
    local entry
    for entry in "${CHECK_RESULTS[@]}"; do
      [[ "$entry" == fail\|* ]] || continue
      IFS='|' read -r _ name detail <<<"$entry"
      printf '    · %-32s %s\n' "$name" "$detail"
    done
    printf '\n  Details im Protokoll: %s\n' "$LOG_FILE"
    printf '  Nach dem Beheben:     bash install.sh  (wiederholbar)\n\n'
  fi
}

# Things the installer cannot decide and the operator must.
#
# Listed explicitly rather than left for someone to discover. Each one is a
# real gap, and two of them are legal requirements before the site takes
# personal data in public.
report::open_points() {
  printf '  %sOffene Punkte%s\n' "$C_BOLD" "$C_RESET"

  if [[ "${SSL_ACTIVE:-0}" != "1" && "$CFG_ENABLE_SSL" == "1" ]]; then
    printf '    · %sHTTPS fehlt.%s Nach korrektem DNS-Eintrag nachholen:\n' "$C_YELLOW" "$C_RESET"
    printf '      certbot --nginx -d %s\n' "$CFG_DOMAIN"
  fi

  if [[ -z "$CFG_SMTP_HOST" ]]; then
    printf '    · %sKein E-Mail-Versand.%s Passwort-Links und Bewerbungsbestätigungen\n' "$C_YELLOW" "$C_RESET"
    printf '      landen nur im Protokoll. Im Dashboard unter Einstellungen → E-Mail.\n'
  fi

  # Not fabricated by the installer, and that is deliberate: an Impressum or a
  # privacy notice invented for a real company would be a false legal claim.
  printf '    · %sDatenschutzerklärung und Impressum fehlen.%s Die Fussleiste verweist\n' "$C_YELLOW" "$C_RESET"
  printf '      auf Platzhalter. Beides ist in der Schweiz Pflicht, sobald die Seite\n'
  printf '      öffentlich Personendaten entgegennimmt — und beides muss vom\n'
  printf '      Unternehmen kommen, nicht vom Installer.\n'

  printf '    · %sEinwilligung im Bewerbungsformular fehlt.%s Das Formular erhebt\n' "$C_YELLOW" "$C_RESET"
  printf '      Personendaten ohne Hinweis auf deren Verarbeitung.\n'

  printf '    · Schriftarten werden von Google geladen. Für den Betrieb in der\n'
  printf '      Schweiz (revDSG) selbst hosten — das entfernt auch zwei Ausnahmen\n'
  printf '      aus der Content-Security-Policy.\n'

  printf '\n'
}

report::to_file() {
  local file="$1" scheme="$2"
  {
    printf 'IEM — Installationsbericht\n'
    printf '==========================\n\n'
    printf 'Zeitpunkt:     %s\n' "$(date -Is)"
    printf 'Host:          %s\n' "$(hostname -f 2>/dev/null || hostname)"
    printf 'System:        %s\n' "$OS_PRETTY"
    printf 'Installer:     %s\n' "$INSTALLER_VERSION"
    printf 'Anwendung:     %s\n' "${APP_VERSION:-unbekannt}"
    printf 'Modus:         %s\n\n' "$INSTALL_MODE"

    printf 'Adressen\n'
    printf '  Website      %s://%s\n' "$scheme" "$CFG_DOMAIN"
    printf '  Dashboard    %s://%s/admin.html\n' "$scheme" "$CFG_DOMAIN"
    printf '  API          %s://%s/api/v1\n\n' "$scheme" "$CFG_DOMAIN"

    printf 'Administrator\n'
    printf '  %s (%s)\n' "$CFG_ADMIN_NAME" "$CFG_ADMIN_EMAIL"
    printf '  Das Passwort ist nicht Teil dieses Berichts.\n\n'

    printf 'Prüfungen: %d bestanden, %d Hinweise, %d Fehler\n\n' \
      "$CHECKS_PASSED" "$CHECKS_WARNED" "$CHECKS_FAILED"

    local entry status name detail symbol
    for entry in "${CHECK_RESULTS[@]}"; do
      IFS='|' read -r status name detail <<<"$entry"
      case "$status" in
        ok)   symbol="[ok]  " ;;
        warn) symbol="[!]   " ;;
        *)    symbol="[FEHL]" ;;
      esac
      printf '  %s %-34s %s\n' "$symbol" "$name" "$detail"
    done

    printf '\nVerzeichnisse\n'
    printf '  Anwendung    %s\n' "$APP_DIR"
    printf '  Daten        %s\n' "$DATA_DIR"
    printf '  Protokolle   %s\n' "$LOG_DIR"
    printf '  Sicherungen  %s\n' "$BACKUP_DIR"
    printf '  Zugangsdaten %s  (nur root, mitsichern)\n' "$CRED_FILE"

    if (( ${#WARNINGS[@]} )); then
      printf '\nHinweise während der Installation\n'
      local w
      for w in "${WARNINGS[@]}"; do printf '  · %s\n' "$w"; done
    fi
  } >"$file"

  chmod 600 "$file"
}
