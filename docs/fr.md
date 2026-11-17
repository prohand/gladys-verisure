# Verisure

Pilotez votre alarme Verisure depuis Gladys : armer, désarmer, suivre ses
détecteurs, et réagir dans vos scènes.

L'intégration passe par le **cloud Verisure** (badge « Cloud » sur les
appareils) : il faut un accès Internet, et les données se rafraîchissent toutes
les 2 minutes par défaut. API non officielle : Verisure peut la changer sans
prévenir.

## Quelle application Verisure ?

Il existe deux clouds Verisure, avec des comptes et des fonctions différents.
Choisissez celui de l'application que vous utilisez :

| Application     | Pays                                                                                     | Ce que Gladys voit                                                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **My Verisure** | France, Espagne, Italie, Portugal, Royaume-Uni, Irlande, Argentine, Brésil, Chili, Pérou | L'alarme (tous ses modes, périmétrique compris) et les capteurs de confort (température, humidité)                                              |
| **Verisure**    | Suède, Norvège, Danemark, Finlande, Belgique, Pays-Bas, Allemagne…                       | L'alarme (désarmée, partielle, totale), les détecteurs d'ouverture, les capteurs de température/humidité, les prises et les serrures connectées |

## Configuration

L'intégration nécessite **Gladys 5.3.0 ou plus récent**.

1. Ouvrez l'onglet **Configuration** de l'intégration.
2. Choisissez votre **application Verisure** et, pour My Verisure, votre
   **pays**.
3. Saisissez l'**identifiant** et le **mot de passe** de votre application.
4. Application Verisure seulement : saisissez le **code de l'alarme** (celui du
   clavier). Il sert à armer, désarmer et piloter les serrures. My Verisure
   n'en a pas besoin.
5. Enregistrez, puis cliquez sur **Tester la connexion**.

### Le code de vérification (première connexion)

À la première connexion, Verisure demande de valider ce nouvel « appareil » :

1. cliquez sur **Envoyer un code** : Verisure envoie un code par SMS (ou par
   e-mail) ;
2. saisissez ce code dans **Valider le code**, puis cliquez sur le bouton.

My Verisure, compte avec plusieurs numéros de téléphone : le premier clic,
**Téléphone** laissé vide, n'envoie rien, il affiche la liste des numéros masqués (`1) ******789,
2) ******245…`). Saisissez la position du vôtre (`2`) ou ses derniers chiffres
(`245`) dans **Téléphone**, puis cliquez à nouveau sur **Envoyer un code**.

C'est fait une seule fois : la session est gardée dans le dossier `/data` de
l'intégration (dans sa configuration Gladys quand Gladys a créé ce dossier en
lecture seule), un redémarrage ne redemande pas de code. Si Verisure en
redemande un plus tard (mot de passe changé, session expirée), l'état de
connexion de l'écran de configuration le dit, et vos scènes peuvent le savoir
avec le déclencheur **La connexion à Verisure est perdue**.

### Les autres réglages

- **Intervalle de rafraîchissement** : 120 secondes par défaut, 60 au minimum.
  Verisure bloque les comptes qui l'interrogent trop souvent (parfois pour
  plusieurs heures) : ne descendez pas sans raison.
- **Logs détaillés** : journalise chaque échange avec Verisure (jamais le mot
  de passe, les codes ou les jetons), pour diagnostiquer un problème.

### Les boutons

- **Tester la connexion** : se connecte, liste vos installations et leur mode.
- **Envoyer un code** / **Valider le code** : la validation par SMS ci-dessus.
- **Oublier la session** : se déconnecte de Verisure et efface la session
  gardée. La prochaine connexion redemandera peut-être un code.

## Les appareils

Après la connexion, ouvrez l'onglet **Découverte** et ajoutez les appareils :

- **Verisure _nom de l'installation_** : le **mode de l'alarme**, une liste à
  choix. Les modes proposés sont ceux de votre centrale : Désarmée, Partielle
  (jour), Partielle (nuit) et Totale, plus les modes périmétriques si votre
  installation a des détecteurs extérieurs. Choisir un mode envoie l'ordre ; la
  valeur change quand Verisure l'a confirmé (de quelques secondes à une minute et demie).
- **Détecteurs d'ouverture** (application Verisure) : ouvert / fermé.
- **Capteurs de température et d'humidité**.
- **Prises connectées** et **serrures** (application Verisure).

Si l'alarme refuse de s'armer (une porte ou une fenêtre ouverte), l'ordre
échoue et Gladys affiche l'erreur.

## Scènes

L'intégration ajoute ses cartes à l'éditeur de scènes (Gladys 5.1 ou plus
récent), dans la catégorie **Intégrations**.

### Déclencheurs

- **Le mode de l'alarme Verisure a changé** : armée ou désarmée depuis le
  clavier, un badge, l'application ou une télécommande. Filtrez sur l'alarme
  et sur le nouveau mode. Les actions suivantes peuvent lire
  `{{triggerEvent.data.mode}}`, `{{triggerEvent.data.previous_mode}}` et
  `{{triggerEvent.data.changed_by}}` (qui a changé le mode, quand Verisure le
  dit). Les ordres donnés par Gladys elle-même ne le déclenchent jamais, pour
  éviter les boucles.
- **Un détecteur d'ouverture Verisure a bougé** (application Verisure) :
  filtrez sur le détecteur et sur l'état (ouverte, fermée).
- **La connexion à Verisure est perdue** : Verisure ne répond plus, refuse la
  connexion, limite les requêtes ou demande un nouveau code. Idéal pour vous
  envoyer un message.
- **L'alarme Verisure s'est déclenchée** : une nouvelle alarme apparaît dans le
  journal d'événements Verisure, même si le mode de l'alarme ne change pas.
  Filtrez sur l'alarme et sur le type : `intrusion`, `fire` (incendie), `sos`
  (bouton panique), `water` (fuite d'eau), `tampering` (sabotage). Les actions
  suivantes peuvent lire `{{triggerEvent.data.kind}}`,
  `{{triggerEvent.data.zone}}` (le détecteur, quand Verisure le dit),
  `{{triggerEvent.data.label}}` (le texte de Verisure) et
  `{{triggerEvent.data.time}}`. Le journal est lu à chaque rafraîchissement :
  comptez jusqu'à l'**Intervalle de rafraîchissement** (2 minutes par défaut)
  de délai. Ce n'est pas une sirène : la télésurveillance Verisure reste le
  premier secours. My Verisure donne `intrusion` et `tampering` ; l'application
  Verisure donne `intrusion`, `fire`, `sos` et `water`. Une alarme survenue
  pendant que Gladys était arrêtée ne déclenche rien au redémarrage.

Les valeurs des modes : `disarmed`, `armed_home` (partielle jour),
`armed_night` (partielle nuit), `armed_away` (totale), `perimeter`,
`armed_home_perimeter`, `armed_night_perimeter`, `armed_away_perimeter`.

### Actions

- **Changer le mode de l'alarme Verisure** : choisissez l'alarme (vide = la
  seule du compte) et le mode. Cochez **Armer même avec une porte ou fenêtre
  ouverte** pour forcer quand la centrale le permet. Résultats pour les
  actions suivantes : `success` (vrai / faux), `mode` (le mode de l'alarme) et
  `reason` (la raison d'un refus, par exemple la porte restée ouverte). Un
  refus n'arrête pas la scène : testez `success` dans une condition.
- **Lire l'alarme Verisure maintenant** : demande son état réel à l'alarme sans
  attendre le prochain rafraîchissement. Résultat : `mode`.

## Tableau de bord

Ajoutez le widget **Alarme Verisure** : mode de l'alarme (vert désarmée,
orange partielle, rouge totale), dernier changement (qui, il y a combien de
temps), portes et fenêtres ouvertes, état de la connexion, température, et des
boutons pour armer (chaque appui demande une confirmation).

Le bouton **Désarmer** n'apparaît que si vous cochez **Afficher un bouton
Désarmer** dans les réglages du widget. Attention : toute personne qui voit ce
tableau de bord peut alors désarmer votre alarme. Ne le cochez pas sur un
tableau de bord partagé ou affiché dans l'entrée.

## Dépannage

- **« Verisure demande un code de vérification »** : suivez
  [la validation par code](#le-code-de-vérification-première-connexion).
- **« Verisure a refusé l'identifiant ou le mot de passe »** : vérifiez-les
  dans l'application Verisure, et l'application choisie (My Verisure ou
  Verisure). L'intégration n'essaie plus tant que la configuration ne change
  pas, pour ne pas bloquer votre compte.
- **« Verisure limite les requêtes »** : l'intégration attend 15 minutes avant
  de réessayer. Augmentez l'intervalle de rafraîchissement si cela revient.
- **Le code de l'alarme manque** (application Verisure) : renseignez-le pour
  armer, désarmer et piloter les serrures.
- Pour le détail, activez les **logs détaillés** et consultez les logs de
  l'intégration depuis Gladys.
