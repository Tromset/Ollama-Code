# qwen-harness

> Harnais de codage agentique 100 % local pour **Qwen 3.5 9B** via **Ollama** — sans API cloud, sans facturation au token, code source intégralement possédé.

Ce README couvre l'installation et l'usage courant. Pour la genèse du projet, les choix d'architecture et l'ingénierie de fiabilité pour petit modèle, voir le document de référence complet : [DOCUMENTATION.md](DOCUMENTATION.md).

## Prérequis

- Node.js ≥ 22 (développé et testé sur Node 26)
- [Ollama](https://ollama.com) en cours d'exécution (`ollama serve`), accessible par défaut sur `http://localhost:11434`
- Le modèle cible récupéré : `ollama pull qwen3.5`

## Installation

```bash
git clone <repo> qwen-harness
cd qwen-harness
npm install
```

Pas d'étape de build : le projet tourne directement depuis les sources TypeScript via `tsx`.

## Démarrage rapide

Depuis le dépôt :

```bash
npm start
```

Ou en tant que commande globale, une fois liée :

```bash
npm link
qwen-harness
```

`bin/qwen-harness.js` résout `tsx` depuis les `node_modules` du paquet et pointe explicitement vers son propre `tsconfig.json` (plutôt que de laisser `tsx` résoudre celui du répertoire courant) — la commande fonctionne donc correctement même invoquée depuis un autre répertoire que le dépôt.

## Utilisation (CLI)

```
qwen-harness                       Lance la TUI (interactif)
qwen-harness [options]

Options:
  --model <name>       Modèle Ollama (défaut : qwen3.5:latest)
  --mode <mode>        Mode d'agent : code | chat | vision | plan (défaut : code)
  --num-ctx <n>        Taille de la fenêtre de contexte (défaut : 32768)
  --host <url>         Hôte Ollama (défaut : http://localhost:11434)
  --yolo               Mode de permission yolo (tout autoriser sauf interdits durs)
  --plan-perms         Mode de permission plan (lecture seule)
  --help, -h           Affiche l'aide

Exemples:
  qwen-harness
  qwen-harness --mode plan --model qwen3.5:latest
  npm run smoke                        Test de streaming rapide, sans TUI
```

⚠️ `--mode plan` (le mode d'agent) et `--plan-perms` (le moteur de permissions) sont deux réglages **indépendants** : `--mode plan` change le prompt système et limite les outils exposés, `--plan-perms` force le moteur de permissions en lecture seule quel que soit le mode d'agent. Rien ne les synchronise automatiquement — combinez les deux pour la garantie maximale en investigation.

## Modes d'agent

| Mode | Outils exposés | Usage |
|---|---|---|
| `code` | les 7 | codage agentique complet |
| `vision` | 3 lecture (`read_file`, `list_files`, `search`) | décrire/analyser des images + contexte projet |
| `plan` | 3 lecture | investiguer et proposer un plan, sans jamais écrire |
| `chat` | aucun | conversation simple |

`think` (raisonnement visible) n'est **pas** dérivé automatiquement du mode choisi au lancement : il vaut `true` par défaut pour les quatre modes tant qu'aucune valeur explicite n'est fournie (CLI/config). Seul un changement de mode **en cours de session** via `/mode` le force à `false` pour `chat`/`vision`/`plan` (`true` uniquement pour `code`).

Détails, garde-fous et diagrammes : voir [DOCUMENTATION.md](DOCUMENTATION.md), section « Modes d'agent ».

## Commandes de la TUI

| Commande | Rôle |
|---|---|
| `/mode [code\|chat\|vision\|plan]` | affiche ou change le mode d'agent |
| `/model [nom]` | affiche ou change le modèle Ollama |
| `/image <chemin>` | attache une image au prochain message |
| `/clear` | efface l'historique de conversation affiché |
| `/sessions` | liste les sessions sauvegardées (20 premières) |
| `/permissions` | affiche la configuration de permissions courante |
| `/help` | liste les commandes |

Raccourcis clavier : `Entrée` envoyer · `Ctrl+C` annuler le tour en cours (sans quitter) · `Ctrl+D` quitter · `Cmd+T` replier/déplier le raisonnement (« thinking ») en direct · `Échap` vider la ligne de saisie · `y`/`n`/`a` répondre à une demande de permission (`a` = toujours autoriser cette action précise).

## Les 7 outils

| Outil | Rôle | Garde-fous |
|---|---|---|
| `read_file` | lire un fichier | confiné au `cwd`, refuse `.env` |
| `write_file` | créer/écraser | idem + création des dossiers parents |
| `edit_file` | remplacement `{path, old, new}` à matching progressif (exact → espaces → fuzzy) | erreur actionnable si aucun match unique |
| `move_file` | déplacer/renommer | 2 chemins validés |
| `list_files` | lister par glob | ignore `node_modules`/`.git`/`dist`, plafond 500 fichiers |
| `search` | grep contenu | ripgrep si disponible (timeout 30 s), sinon fallback JS ; plafond 200 résultats |
| `bash` | commande shell | timeout 120 s par défaut, `cwd` projet, sortie (stdout+stderr) tronquée à 20 000 caractères |

⚠️ `search` et `list_files` ne sont **pas** protégés contre l'exposition de fichiers `.env` de façon aussi fiable que les quatre outils fichiers — voir la section permissions de [DOCUMENTATION.md](DOCUMENTATION.md) avant usage sur un dépôt contenant des secrets réels.

## Configuration

Fusion à précédence croissante (aucune erreur si un fichier est absent) :

```
défauts internes  ←  ~/.qwen-harness/config.json  ←  ./.qwen-harness.json  ←  options CLI
```

Défauts : modèle `qwen3.5:latest`, hôte `http://localhost:11434`, `numCtx` 32768, `maxTurns` 25, sampling `{temperature:1, top_p:0.95, top_k:20, presence_penalty:1.5}`, `think: true` en mode `code`, permissions `{mode:'normal', rules:[]}`.

Les sessions et le journal d'entraînement (`finetune.jsonl`) sont stockés dans `~/.qwen-harness/sessions/`.

## Scripts npm

| Script | Commande | Rôle |
|---|---|---|
| `npm start` | `tsx src/index.ts` | lancer la TUI |
| `npm run dev` | `tsx watch src/index.ts` | dev avec reload |
| `npm run typecheck` | `tsc --noEmit` | vérification des types |
| `npm test` | `vitest run` | tests unitaires |
| `npm run test:watch` | `vitest` | tests en mode watch |
| `npm run smoke` | `tsx scripts/smoke.ts` | smoke test de streaming (sans TUI) |

## Structure du projet

```
bin/qwen-harness.js      point d'entrée CLI global (wrapper tsx)
src/index.ts              parsing des arguments, lancement de la TUI
src/core/                 cœur headless : agent, client Ollama, config, contexte, permissions, prompts, sessions, types
src/tools/                les 7 outils + registry (validation/dispatch)
src/tui/                  TUI Ink (App, commandes slash, composants)
src/media/                utilitaires image (base64, resize)
scripts/smoke.ts          smoke test de streaming rapide
docs/CONTRACTS.md         interfaces TypeScript entre modules (spécification de build)
docs/RUNTIME_API.md       surface de librairie vérifiée (spécification de build)
```

## Tests

```bash
npm test          # vitest run
npm run typecheck # tsc --noEmit
npm run smoke     # vérifie la connexion Ollama + un aller-retour de streaming
```

À ce jour, seule la logique de `edit_file` (matching progressif, `src/tools/fs.ts`) dispose de tests unitaires (`src/tools/fs.test.ts`, 7 cas). Les autres outils, le registry, et toute la couche TUI/CLI n'ont pas encore de couverture automatisée.

## État d'avancement

Le cœur (client, config, permissions, contexte, sessions, 7 outils), la boucle d'agent (`src/core/agent.ts`) et la TUI (`src/tui/*` + `src/index.ts` + `bin/qwen-harness.js`) sont implémentés — le projet est utilisable de bout en bout. Détail complet, limites connues et feuille de route (couverture de test, fine-tuning LoRA, UI web, multimodal vidéo/audio) : voir [DOCUMENTATION.md](DOCUMENTATION.md).

## Documentation complémentaire

- [DOCUMENTATION.md](DOCUMENTATION.md) — document de référence complet : motivation, architecture, ingénierie de fiabilité pour petit modèle, risques et limites.
- [docs/CONTRACTS.md](docs/CONTRACTS.md) — interfaces TypeScript entre modules (spécification écrite avant l'implémentation).
- [docs/RUNTIME_API.md](docs/RUNTIME_API.md) — surface de librairie vérifiée (ollama-js, zod, ink) et contrats d'export par fichier.
