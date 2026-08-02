# Commilot

> _commit + copilot_

Écrit vos messages de commit, et **découpe un gros diff en plusieurs commits propres**.

Tourne en local avec [Ollama](https://ollama.com) : **pas de clé API, pas de quota, votre code ne quitte pas votre machine.**

```
$ commilot split

  ┌── Commit Plan (3 commits) ──────────────────────────────────────┐
  │                                                                 │
  │   1. feat(auth) - add auth middleware to protect routes         │
  │      A  src/middleware/auth.js  (+42)                           │
  │                                                                 │
  │   2. feat(api) - add users endpoint                             │
  │      A  src/routes/users.js  (+28)                              │
  │                                                                 │
  │   3. dev(config) - tighten eslint rules                         │
  │      M  .eslintrc.json  (+8, -4)                                │
  │                                                                 │
  └─────────────────────────────────────────────────────────────────┘

  ? Review commit 1/3 : ❯ Accept · Edit · Merge with next · Skip · Cancel
```

---

## 1. Installer

**Ollama** (une seule fois) :

```bash
brew install ollama          # ou : https://ollama.com/download
ollama serve                 # laisser tourner dans un terminal
ollama pull llama3.1         # ~5 Go, une seule fois
```

**Commilot** :

```bash
git clone https://github.com/elsycharles/commilot
cd commilot
npm ci && npm run build
npm link                     # rend la commande `commilot` disponible partout
```

> Pas envie de `npm link` ? Utilisez le chemin complet :
> `node /chemin/vers/commilot/dist/index.js` — tout fonctionne pareil.

Vérifiez :

```bash
commilot --version
commilot providers           # ollama doit afficher « Ready »
```

---

## 2. Utiliser

Aucune configuration n'est nécessaire. Dans n'importe quel dépôt git :

### Un message pour ce que vous avez indexé

```bash
git add .
commilot generate
```

### Découper un travail en plusieurs commits

```bash
commilot split
```

Commilot lit **tous** vos changements, les regroupe par sujet, et propose un commit par groupe. Vous relisez chacun avant qu'il ne soit créé.

### Voir sans rien créer

```bash
commilot generate --dry-run
commilot split --dry-run
```

Le premier réflexe recommandé. La réponse est mise en cache une heure, donc le vrai lancement qui suit est instantané.

---

## 3. Pendant la relecture

| Choix               | Effet                                       |
| ------------------- | ------------------------------------------- |
| **Accept**          | crée le commit                              |
| **Edit**            | corrige le type, le scope ou la description |
| **Regenerate**      | redemande une proposition _(generate)_      |
| **Merge with next** | fusionne avec le commit suivant _(split)_   |
| **Skip**            | laisse ces fichiers de côté _(split)_       |
| **Cancel**          | tout annuler, rien n'est créé               |

**Rien n'est jamais committé sans votre accord.** Et si un `split` échoue en cours de route, Commilot affiche la commande exacte pour revenir en arrière.

---

## 4. Changer de modèle

Tous les modèles Ollama fonctionnent. Voir les vôtres : `ollama list`.

```bash
# pour un seul lancement
commilot generate --model qwen2.5-coder:7b

# de façon permanente
commilot config set ollama.model qwen2.5-coder:7b
```

Quelques repères :

| Modèle             | Taille | Remarque                             |
| ------------------ | ------ | ------------------------------------ |
| `llama3.1`         | ~5 Go  | défaut, bon compromis                |
| `qwen2.5-coder:7b` | ~5 Go  | meilleur sur le découpage et le code |
| `llama3.2:3b`      | ~2 Go  | plus rapide, moins précis            |

Un modèle local reste moins précis qu'un modèle hébergé : il vous arrivera de voir un commit `misc` regroupant ce qu'il n'a pas su classer. **Aucun fichier n'est jamais perdu** — ça, c'est garanti, contrairement à la qualité du découpage.

---

## 5. Adapter à votre projet

```bash
commilot init
```

Crée `.commilot.yml` (ajouté à votre `.gitignore`). Le réglage le plus utile, ce sont **vos** scopes :

```yaml
provider: ollama

ollama:
  model: llama3.1
  temperature: 0.3 # plus bas = plus prévisible

format:
  template: '{type}({scope}) - {description}'
  types: [dev, feat, bug] # ou [feat, fix, chore, docs]
  scopes: [auth, api, ui] # ⚠️ les vôtres — vide = l'IA invente
  descriptionMaxLength: 72
  language: fr # messages en français

behaviour:
  excludePatterns:
    - 'package-lock.json'
    - '.env*' # ⚠️ à garder si vous activez un provider distant
    - '*.min.js'
  splitMaxCommits: 10
  confirmBeforeCommit: true
  cacheMinutes: 60 # réutilise la réponse d'un diff identique
```

Remplir `scopes` est ce qui change le plus la qualité des messages. Sans cette liste, chaque commit invente son propre vocabulaire.

---

## 6. Toutes les commandes

| Commande                           | Rôle                                              |
| ---------------------------------- | ------------------------------------------------- |
| `commilot generate`                | un message pour les changements indexés           |
| `commilot split`                   | découpe tous les changements en plusieurs commits |
| `commilot init`                    | crée `.commilot.yml`                              |
| `commilot config get\|set\|list`   | lit ou modifie la configuration                   |
| `commilot providers`               | état des backends                                 |
| `commilot hook install\|uninstall` | branche Commilot sur `git commit`                 |

**Options utiles**

| Option               | Effet                                               |
| -------------------- | --------------------------------------------------- |
| `--dry-run`          | affiche sans rien créer                             |
| `--all`              | inclut les fichiers non indexés (défaut de `split`) |
| `--staged`           | seulement l'index (défaut de `generate`)            |
| `--model <nom>`      | change de modèle pour ce lancement                  |
| `--type` / `--scope` | impose le type ou le scope                          |
| `--max-commits <n>`  | plafonne le nombre de commits                       |
| `-y, --yes`          | accepte sans relecture                              |
| `--no-cache`         | force un nouvel appel                               |
| `--verbose`          | détaille ce qui se passe                            |

---

## 7. En cas de problème

| Message                                  | Que faire                                                             |
| ---------------------------------------- | --------------------------------------------------------------------- |
| `No staged changes detected`             | `git add` d'abord, ou utilisez `--all`                                |
| `Cannot reach Ollama…`                   | lancez `ollama serve`                                                 |
| `Ollama does not have the model 'x'`     | `ollama pull x`                                                       |
| `Interactive review requires a terminal` | ajoutez `--yes` ou `--dry-run`                                        |
| `Diff exceeds maximum size`              | committez une partie à la main, ou augmentez `behaviour.maxDiffLines` |

Ajoutez `--verbose` pour voir les échanges avec le modèle.

---

## 8. Utiliser un modèle distant _(optionnel)_

Gemini, ChatGPT et Claude sont implémentés mais **désactivés** : ils demandent une clé API, imposent des quotas, et envoient votre diff à un tiers. Ollama évite les trois.

Pour en activer un malgré tout :

```bash
commilot config set gemini.enabled true
export COMMILOT_GEMINI_KEY="votre-clé"
commilot generate --provider gemini
```

| Provider | Modèle par défaut  | Clé                           |
| -------- | ------------------ | ----------------------------- |
| `ollama` | `llama3.1`         | aucune — **actif par défaut** |
| `gemini` | `gemini-2.0-flash` | `COMMILOT_GEMINI_KEY`         |
| `openai` | `gpt-4o-mini`      | `COMMILOT_OPENAI_KEY`         |
| `claude` | `claude-sonnet-5`  | `COMMILOT_CLAUDE_KEY`         |

Le prompt est identique pour les quatre : seul le transport change.

**Si vous activez un provider distant**, votre diff quitte votre machine. Vérifiez que c'est autorisé pour ce code, et gardez `.env*` dans `excludePatterns`.

---

## Comment ça marche

```
config → provider → git diff → validation → prompt → IA → analyse → relecture → commit
```

Ce qui mérite d'être connu :

- **Rien n'est perdu.** Si le modèle oublie des fichiers, ils atterrissent dans un commit de repli plutôt que d'être ignorés. Si un fichier est cité deux fois, seule la première affectation compte.
- **Ollama est piloté par un schéma JSON.** Sans cela, un modèle local répond un objet unique là où il faudrait un tableau, et le découpage s'effondre.
- **Les gros diffs sont résumés** plutôt que tronqués au hasard : diff complet jusqu'à 500 lignes, hunks raccourcis jusqu'à 2000, statistiques seules au-delà, refus passé 5000.
- **Les clés API ne sont jamais journalisées**, même avec `--verbose`, et `config get` les masque.

---

## Développement

```bash
npm test           # 249 tests
npm run coverage   # seuils à 80 %
npm run lint && npm run typecheck
```

Les tests n'appellent jamais une vraie API : un faux serveur rejoue les réponses de chaque backend. Voir [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

MIT — voir [LICENSE](LICENSE).
