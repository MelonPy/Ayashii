# Ardoise — commander à plusieurs

Application web (statique, hébergée sur GitHub Pages) pour les restaurants à volonté
où l'on commande en écrivant des quantités sur une ardoise. Chaque convive choisit
ses plats sur son téléphone ; l'application additionne tout et affiche la liste
« numéro → quantité » à recopier sur l'ardoise.

Premier restaurant : **Nation Ayashi** (formule à volonté, 88 numéros + soupes).

## Fonctionnement

1. Quelqu'un ouvre une table → un code à 6 caractères + un QR code.
2. Les autres scannent le QR code (ou tapent le code) et donnent leur prénom.
3. Chacun choisit ses plats dans l'onglet **Menu** (limite de 5 portions par personne
   et par tournée, plats « soir & week-end » grisés le midi) puis appuie sur « J'ai fini ».
4. L'onglet **Ardoise** affiche le total trié par numéro, qui a pris quoi et qui n'a pas
   encore fini. Touchez une ligne pour la barrer une fois recopiée.
5. Une fois l'ardoise remise au serveur : **Commande passée ✓**. Tout le monde repart
   à zéro pour la tournée suivante (annulable).
6. L'onglet **Table** donne le QR code, les convives, l'historique des tournées et une
   addition estimée (formule midi/soir, adulte/enfant, suppléments et boissons).

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

1. Créer `restaurants/<id>.json` sur le modèle de `restaurants/nation-ayashi.json` :
   - `rules.maxPerRound` : portions max par personne et par tournée (0 ou absent = illimité) ;
   - `periods` : formules et leurs prix par type de convive (`schedule` permet de
     détecter automatiquement le midi) ;
   - `categories` : `periods` pour restreindre une catégorie (ex. soir uniquement),
     `extra: true` pour les catégories payantes hors formule (boissons) ;
   - `items` : `n` = numéro écrit sur l'ardoise, `price` = supplément ou prix.
2. L'ajouter dans `restaurants/index.json`.

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
