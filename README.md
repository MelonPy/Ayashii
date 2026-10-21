# Ardoise — commander à plusieurs

Application web (statique, hébergée sur GitHub Pages) pour les restaurants à volonté
où l'on commande en écrivant des quantités sur une ardoise. Chaque convive choisit
ses plats sur son téléphone ; l'application additionne tout et affiche la liste
« numéro → quantité » à recopier sur l'ardoise.

Premier restaurant : **Nation Ayashi** (formule à volonté, 88 numéros + soupes).

## Fonctionnement

1. Quelqu'un ouvre une table → un code à 6 caractères + un QR code. Cette personne
   devient l'**hôte** de la table (voir plus bas).
2. Les autres scannent le QR code (ou tapent le code) et donnent leur prénom.
3. Chacun choisit ses plats dans l'onglet **Menu** (plats « soir & week-end » grisés le
   midi) puis appuie sur « J'ai fini ». Pas de limite par défaut : l'hôte peut activer
   une limite de portions par personne et par tournée dans **Table → Réglages**.
4. L'onglet **Ardoise** affiche le total trié par numéro, qui a pris quoi et qui n'a pas
   encore fini. Touchez une ligne pour la barrer une fois recopiée.
5. Une fois l'ardoise remise au serveur, l'hôte appuie sur **Commande passée ✓**. Tout
   le monde repart à zéro pour la tournée suivante (annulable par l'hôte).
6. L'onglet **Table** donne le QR code, les convives, l'historique des tournées, une
   addition estimée (formule midi/soir, adulte/enfant, suppléments et boissons), les
   documents à imprimer et les informations pratiques du restaurant.

### Clôture de la table

Une table se clôture **automatiquement 6 heures après son ouverture**, ou plus tôt par
l'hôte (**Table → Clôturer la table maintenant**). Une fois clôturée, plus personne ne
peut commander ni modifier les réglages ; les choix non envoyés sont abandonnés.
L'historique, l'addition estimée et le récapitulatif imprimable restent consultables, et
la table apparaît comme « clôturée » dans « Reprendre une table ». En cas d'erreur, l'hôte
peut la **rouvrir** (elle repart alors pour 6 heures).

### L'hôte de la table

Celui qui ouvre la table en garde le contrôle : lui seul peut valider ou annuler l'envoi
d'une tournée, modifier les réglages (formule midi / soir, limite par tournée, n° de
table au restaurant) et gérer les convives (bouton **Gérer** :
confier la table à quelqu'un d'autre, ou retirer une personne partie ou connectée par
erreur). Les autres voient l'ardoise et peuvent la copier ou l'imprimer.
Si l'hôte ne donne plus signe de vie pendant 15 minutes (téléphone éteint…), n'importe
quel convive peut **prendre la main**.

### Menu : favoris et illustrations

- Chaque plat a une vignette avec un émoji (et un second en médaillon pour l'ingrédient
  principal) et son numéro. Seuls des émojis Unicode ≤ 11 (2018) sont utilisés, pour
  s'afficher sur la quasi-totalité des téléphones (Android 9+, iOS 12+).
- La section **★ Favoris** en haut du menu regroupe les plats marqués d'une étoile ☆
  (enregistrés sur le téléphone, par restaurant). Tant qu'on n'en a pas, elle propose les
  suggestions du restaurant (`favorites` dans le JSON).

### Impression et bon de commande

Sur l'**Ardoise**, le bouton **🧾 Bon de commande** imprime la tournée pour la remettre au
restaurant : n° de table dans la salle (réglage de l'hôte), tournée, heure, nombre de
couverts et formule, puis les numéros et quantités en gros caractères, le total de
portions et les boissons à part. Une fois le bon imprimé, l'hôte peut clore la tournée
d'un geste (« Tournée envoyée ✓ »). L'onglet **Table** imprime aussi le récapitulatif
(tournées + addition estimée) et une affichette avec le QR code de la table.

- `js/print.js` : les documents (liste de blocs), rendus en HTML (aperçu et impression par
  le navigateur, formats ticket 58 mm, 80 mm ou A4) et en texte à largeur fixe (« Texte »).
- `js/escpos.js` : les mêmes documents en commandes **ESC/POS** pour imprimante thermique
  (accents en page de code PC858, gros caractères, QR code, coupe du papier ; option
  « sans accents » pour les modèles qui n'ont pas PC858).
- `js/thermal.js` : connexion directe à l'imprimante depuis le navigateur, en
  **Bluetooth** (Web Bluetooth) ou **USB** (WebUSB) — Chrome / Edge sur Android et
  ordinateur, pas sur iPhone. Une fois l'imprimante connectée, le bouton « Bon de
  commande » imprime directement, sans aperçu. « Fichier ESC/POS » télécharge le ticket
  brut, à envoyer par exemple à une imprimante réseau : `nc <ip-imprimante> 9100 < bon.bin`.

Ces chemins ont été testés avec une imprimante simulée ; à valider avec un vrai modèle.

## Synchronisation

GitHub Pages ne sert que des fichiers statiques. Les téléphones d'une même table
s'échangent donc leurs actions via [ntfy.sh](https://ntfy.sh), un relais pub/sub
public et gratuit, sans compte : chaque table correspond à un « topic »
`ardoise-v1-<restaurant>-<code>`. Les messages y sont conservés environ 12 h, ce qui
permet à un retardataire de récupérer l'état de la table.

- Chaque appareil garde aussi tout en local (`localStorage`) : l'appli reste utilisable
  hors-ligne et renvoie les modifications au retour du réseau.
- L'état est recalculé à partir de la liste des événements (`js/store.js`), donc tous
  les téléphones convergent vers la même ardoise, quel que soit l'ordre d'arrivée.
- Le code de table est le seul « secret » : quiconque le connaît peut voir et modifier
  la commande. C'est suffisant pour une commande de sushis, pas pour des données sensibles.
- Pour utiliser un autre serveur ntfy (auto-hébergé par exemple), ajoutez
  `?relay=https://mon-ntfy.example.com` à l'URL.

## Ajouter un restaurant

Le format est décrit par `restaurants/schema.json` (JSON Schema : les éditeurs comme
VS Code complètent et vérifient automatiquement grâce à la ligne `"$schema"`).

1. Créer `restaurants/<id>.json` sur le modèle de `restaurants/nation-ayashi.json` :
   - `rules.maxPerRound` : limite de portions par personne et par tournée proposée à l'hôte
     (désactivée à l'ouverture de la table, sauf `rules.limitByDefault: true`) ;
   - `periods` : formules et leurs prix par type de convive (`schedule` permet de
     détecter automatiquement le midi) ;
   - `categories` : `periods` pour restreindre une catégorie (ex. soir uniquement),
     `extra: true` pour les catégories payantes hors formule (boissons) ;
   - `items` : `n` = numéro écrit sur l'ardoise, `price` = supplément ou prix,
     `icon` = émoji(s) du plat (par défaut celui de la catégorie) ;
   - `favorites` : numéros proposés dans « Favoris » aux nouveaux venus ;
   - `info` : adresse, téléphone, site, horaires (`days` : 0 = dimanche … 6 = samedi,
     `slots` : créneaux `["11:30", "14:30"]`), services et remarques. Ces informations
     s'affichent sur la page du restaurant, avec l'état « ouvert / fermé ».
2. L'ajouter dans `restaurants/index.json`.
3. Vérifier : `node tools/check-restaurants.mjs` (structure, références, émojis
   compatibles). Le déploiement lance la même vérification.

## Développement local

```sh
node tools/dev-server.mjs
# puis ouvrir http://localhost:8787/?relay=http://localhost:8787/relay
```

Le serveur de dev sert le site et un mini-relais compatible ntfy en mémoire, pour
tester à plusieurs onglets / appareils sur le réseau local sans dépendre de ntfy.sh.

## Mise en ligne

Le workflow `.github/workflows/pages.yml` publie le site à chaque push sur `main`.
Il faut une seule fois activer Pages : *Settings → Pages → Source : GitHub Actions*.
