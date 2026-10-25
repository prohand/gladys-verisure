# Verisure

Steuere deine Verisure-Alarmanlage aus Gladys: scharf und unscharf schalten,
ihre Melder verfolgen und in deinen Szenen darauf reagieren.

Die Integration läuft über die **Verisure-Cloud** (Badge „Cloud“ an den
Geräten): Sie benötigt einen Internetzugang, und die Daten werden standardmäßig
alle 2 Minuten aktualisiert. Inoffizielle API: Verisure kann sie ohne
Vorankündigung ändern.

## Welche Verisure-App?

Es gibt zwei Verisure-Clouds mit unterschiedlichen Konten und Funktionen.
Wähle die der App, die du verwendest:

| App             | Länder                                                                                                      | Was Gladys sieht                                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **My Verisure** | Frankreich, Spanien, Italien, Portugal, Vereinigtes Königreich, Irland, Argentinien, Brasilien, Chile, Peru | Die Alarmanlage (alle Modi, Perimeter inklusive) und die Komfortsensoren (Temperatur, Luftfeuchtigkeit)                                             |
| **Verisure**    | Schweden, Norwegen, Dänemark, Finnland, Belgien, Niederlande, Deutschland…                                  | Die Alarmanlage (unscharf, teilscharf, vollscharf), Tür-/Fensterkontakte, Temperatur-/Feuchtigkeitssensoren, smarte Steckdosen und smarte Schlösser |

## Konfiguration

Die Integration benötigt **Gladys 5.3.0 oder neuer**.

1. Öffne den Tab **Konfiguration** der Integration.
2. Wähle deine **Verisure-App** und, bei My Verisure, dein **Land**.
3. Gib den **Benutzernamen** und das **Passwort** deiner App ein.
4. Nur Verisure-App: Gib den **Alarmcode** ein (den des Bedienteils). Er
   schaltet die Alarmanlage scharf und unscharf und steuert die Schlösser. My
   Verisure benötigt ihn nicht.
5. Speichere und klicke dann auf **Verbindung testen**.

### Der Bestätigungscode (erste Verbindung)

Bei der ersten Verbindung verlangt Verisure, dieses neue „Gerät“ zu bestätigen:

1. Klicke auf **Code senden**: Verisure sendet einen Code per SMS (oder
   E-Mail);
2. gib den Code unter **Code bestätigen** ein und klicke dann auf die
   Schaltfläche.

Das geschieht nur einmal: Die Sitzung wird im Ordner `/data` der Integration
aufbewahrt, ein Neustart verlangt keinen neuen Code. Fragt Verisure später
erneut (Passwort geändert, Sitzung abgelaufen), zeigt der Verbindungsstatus des
Konfigurationsbildschirms das an, und deine Szenen erfahren es über den
Auslöser **Die Verbindung zu Verisure ist unterbrochen**.

### Die weiteren Einstellungen

- **Aktualisierungsintervall**: standardmäßig 120 Sekunden, mindestens 60.
  Verisure sperrt Konten, die zu oft anfragen (manchmal für Stunden): Senke
  es nicht ohne Grund.
- **Detaillierte Logs**: protokolliert jeden Austausch mit Verisure (niemals
  das Passwort, die Codes oder die Token), um ein Problem zu diagnostizieren.

### Die Schaltflächen

- **Verbindung testen**: meldet sich an und listet deine Installationen und
  deren Modus auf.
- **Code senden** / **Code bestätigen**: die SMS-Bestätigung oben.
- **Sitzung vergessen**: meldet sich bei Verisure ab und löscht die
  aufbewahrte Sitzung. Die nächste Verbindung kann erneut einen Code verlangen.

## Geräte

Öffne nach der Verbindung den Tab **Entdecken** und füge die Geräte mit
**Zu Gladys hinzufügen** hinzu:

- **Verisure _Name der Installation_**: der **Alarmmodus**, eine Auswahl. Die
  angebotenen Modi sind die deiner Zentrale: Unscharf, Teilscharf (Tag),
  Teilscharf (Nacht) und Vollscharf, dazu die Perimeter-Modi, wenn deine
  Installation Außenmelder hat. Die Wahl eines Modus sendet den Befehl; der
  Wert ändert sich, sobald Verisure ihn bestätigt hat (von wenigen Sekunden bis
  zu anderthalb Minuten).
- **Tür-/Fensterkontakte** (Verisure-App): offen / geschlossen.
- **Temperatur- und Feuchtigkeitssensoren**.
- **Smarte Steckdosen** und **Schlösser** (Verisure-App).

Verweigert die Alarmanlage das Scharfschalten (eine Tür oder ein Fenster
offen), schlägt der Befehl fehl und Gladys zeigt den Fehler an.

## Szenen

Die Integration fügt dem Szenen-Editor eigene Karten hinzu (Gladys 5.1 oder
neuer), unter der Kategorie **Integrationen**.

### Auslöser

- **Modus der Verisure-Alarmanlage geändert**: am Bedienteil, mit einem Badge,
  über die App oder eine Fernbedienung scharf oder unscharf geschaltet. Filter
  auf die Alarmanlage und den neuen Modus. Die folgenden Aktionen können
  `{{triggerEvent.data.mode}}`, `{{triggerEvent.data.previous_mode}}` und
  `{{triggerEvent.data.changed_by}}` lesen (wer ihn geändert hat, wenn Verisure
  es mitteilt). Befehle von Gladys selbst lösen ihn nie aus, um Schleifen zu
  vermeiden.
- **Ein Verisure-Tür-/Fensterkontakt hat sich geändert** (Verisure-App): Filter
  auf den Melder und den Zustand (geöffnet, geschlossen).
- **Die Verbindung zu Verisure ist unterbrochen**: Verisure antwortet nicht
  mehr, verweigert die Anmeldung, drosselt die Anfragen oder verlangt einen
  neuen Code. Ideal, um sich selbst eine Nachricht zu senden.

Die Werte der Modi: `disarmed`, `armed_home` (teilscharf Tag), `armed_night`
(teilscharf Nacht), `armed_away` (vollscharf), `perimeter`,
`armed_home_perimeter`, `armed_night_perimeter`, `armed_away_perimeter`.

### Aktionen

- **Modus der Verisure-Alarmanlage ändern**: Wähle die Alarmanlage (leer
  = die einzige des Kontos) und den Modus. Aktiviere **Auch bei offener
  Tür oder offenem Fenster scharf schalten**, um das Scharfschalten zu
  erzwingen, wenn die Zentrale es erlaubt. Ergebnisse für die folgenden
  Aktionen: `success` (true / false), `mode` (der Alarmmodus) und `reason`
  (warum abgelehnt wurde, z. B. die offen gelassene Tür). Eine Ablehnung hält
  die Szene nicht an: Prüfe `success` in einer Bedingung.
- **Verisure-Alarmanlage jetzt abfragen**: fragt die Alarmanlage nach ihrem
  tatsächlichen Zustand, ohne auf die nächste Aktualisierung zu warten.
  Ergebnis: `mode`.

## Dashboard

Füge unter **Dashboard → Bearbeiten → Neues Widget** das Widget
**Verisure-Alarmanlage** hinzu: Alarmmodus (grün unscharf, orange teilscharf,
rot vollscharf), letzte Änderung (wer, vor wie langer Zeit), offene Türen und
Fenster, Verbindung, Temperatur und Tasten zum Scharfschalten (jedes Antippen
verlangt eine Bestätigung).

Die Taste **Unscharf schalten** erscheint nur, wenn du in den
Widget-Einstellungen **Taste „Unscharf schalten“ anzeigen** aktivieren.
Achtung: Jeder, der dieses Dashboard sieht, kann deine Alarmanlage dann
unscharf schalten. Aktiviere es nicht auf einem gemeinsam genutzten
Dashboard oder einem, das im Eingangsbereich angezeigt wird.

## Fehlerbehebung

- **„Verisure verlangt einen Bestätigungscode“**: Folge
  [der Code-Bestätigung](#der-bestätigungscode-erste-verbindung).
- **„Verisure hat den Benutzernamen oder das Passwort abgelehnt“**: Prüfe
  sie in der Verisure-App sowie die gewählte App (My Verisure oder Verisure).
  Die Integration versucht es nicht mehr, bis sich die Konfiguration ändert,
  damit dein Konto nicht gesperrt wird.
- **„Verisure begrenzt die Anfragen“**: Die Integration wartet 15 Minuten,
  bevor sie es erneut versucht. Erhöhe das Aktualisierungsintervall, wenn
  es wieder vorkommt.
- **Der Alarmcode fehlt** (Verisure-App): Trag ihn ein, um scharf und
  unscharf zu schalten und die Schlösser zu steuern.
- Für Details schalte die **detaillierten Logs** ein und lies die
  Logs der Integration in Gladys.
