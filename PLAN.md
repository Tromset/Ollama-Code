# qwen-harness — Plan de build (référence partagée agents)

> Harness agentique **100 % code source contrôlé** pour exploiter **Qwen 3.5 9B en local via Ollama** :
> coder de façon agentique (éditer des codebases, déplacer des fichiers, exécuter des commandes),
> TUI d'abord puis UI web par catégories. Objectif : ne plus dépendre d'un LLM cloud facturé.
> À terme : fine-tuning sur données perso + multimodal.

**Ce fichier est la source de vérité pour tous les agents de build. Le lire avant toute tâche.**

---

## 0. Environnement (vérifié le 16/07/2026)

- Mac Apple **M4, 16 Go RAM**, macOS 26.5.2 — **Node v26.0.0**, **npm 11.12.1**, git 2.50.1
- **Ollama 0.32.0**. Modèles tirés : `qwen3.5:latest` (9,7B dense, Q4_K_M, 6,6 Go) et `llama3.2:latest` (test capacités).
- `ollama show qwen3.5` : capacités = **completion, vision, tools, thinking** — contexte max **262 144**.
- ⚠️ **Piège n°1** : chargé avec **contexte 4096 par défaut** (<24 Go VRAM ⇒ 4K). **Un agent meurt avec 4K.**

## 1. Contraintes techniques structurantes (NON négociables)

1. **API native `/api/chat` uniquement** — PAS le endpoint OpenAI `/v1` (bug d'index tool-calls multiples en streaming, issue ollama#15457 ; et `num_ctx` non réglable par requête via `/v1`).
2. **Lib npm officielle `ollama`** (v0.6.x) : chat/streaming `AsyncGenerator`/tools/think/images. **Limite : `abort()` coupe TOUS les streams d'une instance ⇒ 1 instance client par tâche annulable.**
3. **`options.num_ctx` explicite à CHAQUE requête.** Défaut **32 768** (16 Go, Q4_K_M ; l'archi hybride Gated DeltaNet réduit le KV cache — 8 couches d'attention pleine sur 32). Configurable jusqu'à 64K. Option `OLLAMA_KV_CACHE_TYPE=q8_0` si mémoire tendue. Afficher l'usage contexte dans la TUI (`prompt_eval_count`/`eval_count` du chunk final).
4. **Tool calling natif** : `tools` au format OpenAI (JSON Schema) ; réponse dans `message.tool_calls` (**arguments déjà parsés en objet**) ; **pas de `tool_call_id`** — résultat renvoyé en `{role:"tool", tool_name, content}`. Appels parallèles supportés. En streaming, **accumuler** `message.thinking` + `message.content` + `message.tool_calls` puis tout repasser dans l'historique.
5. **Thinking actif par défaut** (`message.thinking`, streamé AVANT le contenu) ; `think: true|false|"low"|"medium"|"high"`. Parser + afficher (repliable).
6. **Multimodal via Ollama = texte + images seulement** (base64 dans `messages[].images`). Pas d'audio/vidéo dans l'API. ⇒ Phase 3 : vidéo = frames ffmpeg ; audio = STT externe (whisper.cpp) en pipeline d'entrée.
7. **Structured outputs** : `format` = JSON Schema (compatible `z.toJSONSchema`, Zod 4) — pour features internes (titres de session, résumés de compaction).

## 2. Patterns petits modèles (8-9B) — impératifs de fiabilité

- **7 tools max**, descriptions COURTES.
- Édition par **`str_replace`** (`old`/`new` en arguments JSON — pas de diff unifié, pas de n° de ligne) avec **matching progressif** : exact → whitespace-normalisé → fuzzy, et **messages d'erreur détaillés/actionnables** (le modèle réessaie).
- **Limite 20-30 tours** (on cible 25).
- **Validation Zod des arguments + retry.**
- Secours si l'édition échoue trop : **pattern architecte/éditeur d'aider** (2ᵉ appel dédié à l'application des edits).
- **Logger les sessions en JSONL dès la v1** (format messages + tool_calls structurés + métadonnées succès/échec) → base du fine-tuning Phase 4.

## 3. Décisions actées

- **TypeScript** (ESM, lancé via **tsx**, scripts npm — **pas de build quotidien**). `moduleResolution: "Bundler"` pour éviter les extensions `.js` dans les imports.
- **TUI d'abord (v1)**, UI web par catégories en **phase 2**, **même core headless**.
- Multimodal : v1 = **texte + images** ; vidéo/audio via pipelines externes en phase 3.
- **Sampling** : garder les défauts Modelfile Ollama (temp 1, top_p 0.95, top_k 20, presence_penalty 1.5), surchargeables par config ; `think: true` par défaut en mode Code.
- **Détection dynamique des capacités** via `/api/show` → marche aussi avec `llama3.2` et tout futur modèle.

## 4. Architecture (cœur headless, aucun import UI dans `core/`)

```
Harness Qwen 3.5/
├── package.json            # scripts: start (TUI), dev, typecheck, test
├── tsconfig.json
├── src/
│   ├── index.ts            # entrée CLI (parse args, lance la TUI)
│   ├── core/
│   │   ├── client.ts       # wrapper ollama-js : /api/chat natif, num_ctx imposé,
│   │   │                   #   1 instance/tâche annulable, détection capacités via show()
│   │   ├── agent.ts        # boucle agentique : stream → accumule thinking/content/tool_calls
│   │   │                   #   → permissions → exécute → role:"tool" → boucle (max 25 tours)
│   │   ├── context.ts      # budget tokens : cap sorties de tools, compaction à ~75 %
│   │   ├── permissions.ts  # allow/ask/deny par catégorie + globs bash + globs chemins ;
│   │   │                   #   deny .env ; modes plan/normal/yolo
│   │   ├── session.ts      # persistance sessions + LOG JSONL fine-tuning
│   │   ├── prompts.ts      # system prompts COURTS par catégorie (code / chat / vision)
│   │   └── config.ts       # ~/.qwen-harness/config.json + .qwen-harness.json par projet
│   ├── tools/
│   │   ├── registry.ts     # défs zod → JSON Schema, validation args, dispatch, erreurs actionnables
│   │   ├── fs.ts           # read_file, write_file, edit_file (str_replace progressif), move_file
│   │   ├── search.ts       # list_files (glob), search (ripgrep si dispo, sinon fallback JS)
│   │   └── bash.ts         # bash avec timeout, cwd projet, troncature sortie
│   ├── media/
│   │   └── images.ts       # fichier → base64 (+ redimensionnement), branché sur /image en TUI
│   └── tui/
│       ├── app.tsx         # Ink (Node ≥22, React ≥19.2, alternateScreen)
│       ├── components/     # messages, thinking repliable, aperçu diff avant écriture,
│       │                   #   prompt d'approbation (y/n/toujours), barre de statut
│       └── commands.ts     # /mode /model /image /clear /sessions /permissions /help
```

## 5. Les 7 tools (aucun de plus en v1)

`read_file` · `edit_file` (str_replace progressif) · `write_file` · `move_file` · `list_files` (glob) · `search` (ripgrep/fallback JS) · `bash` (timeout, cwd, troncature).

## 6. Catégories = modes d'agent (le « UI par catégories »)

- **Code** : tous les tools, prompt codage, `think: true`.
- **Chat** : aucun tool.
- **Vision** : images + tools de lecture.
- **Plan** : lecture seule (ne doit **jamais** écrire).

Sélecteur dans la TUI ; réutilisés tels quels par l'UI web (phase 2).

## 7. Phases & vagues d'orchestration

Orchestration : **Claude Opus (manager) crée des sous-agents Sonnet 5 en vagues ordonnées par dépendance.** Parallélisme seulement sur fichiers disjoints.

- **Phase 0 — Scaffold** : package.json, tsconfig strict ESM, structure, `git init`, TUI Ink hello-world connectée à Ollama (echo streaming réel, num_ctx imposé). ✅ Critère : `npm run typecheck` OK + smoke test streaming + `ollama ps` montre **32K** (pas 4096).
- **Phase 1 — v1 agentique (cœur)** : `client.ts` + `config.ts` → `tools/*` + `registry.ts` → `agent.ts` + `permissions.ts` + `context.ts` → TUI complète → `session.ts` (JSONL) → images (`/image`). Tests vitest (matching d'édition, registry) + test d'intégration réel.
- **Phase 2 — UI web par catégories** : `src/server/` (HTTP local + SSE streaming, REST sessions/messages/approbations) + `web/` (Vite + React, mêmes modes). Même core.
- **Phase 3 — Multimodal étendu** : vidéo → frames ffmpeg ; audio → whisper.cpp ; veille support audio Ollama.
- **Phase 4 — Fine-tuning** : export JSONL (trajectoires réussies) → mlx-lm (`mlx_lm.lora`, QLoRA/LoRA) → `mlx_lm.fuse` → GGUF (llama.cpp) → `ollama create qwen3.5-victor`. Texte/tool-calling d'abord (vision = mmproj, plus complexe).

## 8. Critères de vérification (par phase)

- **Contexte** : TUI lancée → `ollama ps` montre 32K, jamais 4096.
- **Boucle E2E** : bac à sable → « crée `hello.ts` qui affiche la date, exécute-le » → `write_file` → `bash` avec approbations ; puis « renomme en `date.ts`, corrige l'import » → `edit`/`move`.
- **Robustesse édition** : tests vitest matching progressif + erreurs exploitables (le modèle retente).
- **Vision** : `/image capture.png` + « décris ce screenshot » → réponse cohérente.
- **Permissions** : `rm -rf` refusé ; mode Plan n'écrit jamais.
- **Logs FT** : JSONL contient system prompt, schémas de tools, `tool_calls` en objets, flag succès/échec.
- **Mémoire** : surveiller la pression mémoire à num_ctx 32K/16 Go ; si swap → 24K ou `OLLAMA_KV_CACHE_TYPE=q8_0`.

## 9. Risques connus

- **16 Go de RAM = la vraie contrainte.** Contexte 32K défaut, compaction agressive, tout configurable.
- **Fiabilité d'un 9B en agentique** : mitigée par peu de tools, descriptions courtes, erreurs actionnables, validation+retry ; secours architecte/éditeur.
- Les faits ci-dessus s'appuient sur docs officielles Ollama/HuggingFace (recherche du 16/07/2026), non contre-vérifiés indépendamment — **le code tranchera à l'implémentation.**
