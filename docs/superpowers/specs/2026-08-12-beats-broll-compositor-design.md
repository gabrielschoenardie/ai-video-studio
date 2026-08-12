# Design — Compositor B-ROLL/TRILHA no step BEATS

**Data:** 2026-08-12
**Arquivos-alvo:** `public/index.html` (extensão do módulo JS/CSS do BEATS, mesma IIFE), `server.js` (extensão pequena das rotas `GET`/`POST /api/beats` já existentes).
**Pré-requisito:** `docs/plans/beat-timeline-editor.md` já executado e commitado (`9ff7538`) — a timeline do BEATS (tracks BEATS/ÁUDIO/LEGENDA, transport, snap, undo/redo, persistência) já existe e funciona.

## Contexto e problema

O plano `beat-timeline-editor.md` deixou de fora, deliberadamente, tracks de B-ROLL e TRILHA editáveis, porque exigiam um jeito de posicionar clipes em **tempo absoluto** da timeline montada — algo que não existia no app. O `clipper.js` corta cada momento em arquivo próprio com tempo **local** (0..dur), o que tornaria qualquer posição de B-ROLL um dado inventado se derivada dali.

Este plano resolve isso contornando o problema, não resolvendo-o: em vez de derivar posições automaticamente do `clipper.js`, o usuário posiciona manualmente clipes (já enviados via upload, do jeito que o app já suporta) na timeline absoluta do vídeo montado — como numa NLE (Premiere/Resolve). Nenhuma posição é inferida; toda posição é escolha explícita do usuário. Isso também abre a porta para um preview ao vivo de verdade, já que as fontes (arquivos de vídeo/áudio reais) e suas posições (tempos absolutos reais) existem antes de qualquer render.

## Objetivo

Adicionar 2 tracks novas ao step BEATS — **B-ROLL** (cutaways visuais) e **TRILHA** (música de fundo) — com:
- clipes arrastáveis/aparáveis, posicionados livremente na timeline absoluta (não contíguos como os beats — podem ter espaços vazios);
- um preview ao vivo que **realmente composita** o resultado durante playback contínuo (troca pro B-ROLL certo no tempo certo, sem travar, com áudio principal + música tocando juntos);
- persistência no mesmo sidecar `.beats.json` já usado pelos beats (schema estendido, mesmo botão SALVAR/CARREGAR).

**Fora de escopo (deliberado, ver seção final):** renderização/export real com os cutaways embutidos no MP4 final; origem automática de B-ROLL via `clipper.js`; in-point de origem por clipe; crossfade de áudio; qualquer coisa da aba "Estilo" do protótipo (tela dividida, headline, legenda customizada) — isso é composição visual e pertence ao `remotion/`, não ao timeline editor.

## Abordagem escolhida

**Canvas + elementos de mídia nativos em paralelo**, com o `<video>` principal continuando como relógio mestre (mesmo padrão já usado pelo BEATS hoje — `currentTime`/`timeupdate` dirigem o playhead).

- O preview do BEATS passa a desenhar num `<canvas>` em vez de mostrar o `<video>` principal diretamente. A cada `requestAnimationFrame`, o canvas desenha (`drawImage`) o quadro do elemento de vídeo que estiver ativo no tempo atual: o principal, ou — se o tempo atual cai dentro da janela de um clipe de B-ROLL — o `<video>` desse clipe, mantido em sincronia (seu `currentTime` = relógio mestre − início do clipe na timeline), tocando mudo.
- Áudio **não** passa por Web Audio API / `AudioContext`. O vídeo principal (que carrega a narração) e os clipes de TRILHA tocam nativamente em paralelo — múltiplos elementos de mídia HTML tocando ao mesmo tempo já se misturam sozinhos no mixer de áudio do navegador. Volume por clipe usa a propriedade `.volume` nativa do elemento, sem grafo de gain nodes.
- Zero dependências novas; reaproveita quase toda a infraestrutura do BEATS (`snapTargets`/`snapTime`, transport, undo/redo por snapshot, persistência).

**Alternativas descartadas:**
- **Troca de `src` no mesmo `<video>` visível ao cruzar bordas de B-ROLL** — mais simples de implementar, mas cada troca de fonte recarrega/decodifica de novo (stall de ~50-150ms, tela preta perceptível), quebrando a promessa de preview "sem emenda tipo Premiere" pedida explicitamente.
- **Pré-renderizar no servidor a cada edição e tocar o resultado flatten** — daria playback nativo perfeito, mas viola a decisão de escopo de não ter passo de render real, e não seria "ao vivo" (latência de re-encode a cada ajuste).

## Desenho detalhado

### 1. Modelo de dados (sidecar `.beats.json`, schema v2)

Estende o sidecar já existente — mesmo arquivo, mesmas rotas `GET`/`POST /api/beats`, mesmo botão SALVAR BEATS/CARREGAR. Sem rota nova, sem sidecar novo.

```json
{
  "version": 2,
  "video": "output/assembled-xxx.mp4",
  "duration": 8,
  "beats": [ { "label": "HOOK", "start": 0, "dur": 0.9 } ],
  "broll": [ { "path": "jobs/uploads/xxx.mp4", "start": 2.1, "dur": 3.0 } ],
  "music": [ { "path": "jobs/uploads/yyy.mp3", "start": 0, "dur": 8.0, "volume": 0.5 } ],
  "updatedAt": "..."
}
```

`server.js`: no handler `POST /api/beats`, aceitar `broll`/`music` como arrays opcionais (default `[]` se ausentes ou não-array — não rejeitar a request, só normalizar), gravá-los no payload, devolvê-los no `GET`. Path safety (`resolveInput`/`insideRoot`) continua só sobre o `video` do sidecar — os `path` dentro de `broll[]`/`music[]` são validados no cliente contra o array `assets` já carregado na sessão (mesma fonte confiável usada pra popular os outros selects), não abrem superfície nova de leitura de arquivo arbitrário no servidor.

Beats existentes sem `broll`/`music` (schema v1, salvos pelo plano anterior) continuam carregando normalmente — campos ausentes tratados como arrays vazios no cliente.

### 2. Tracks B-ROLL e TRILHA — estrutura e interação

Duas tracks novas na mesma timeline (`#bt-root`), abaixo de LEGENDA, seguindo o mesmo `.bt-track-row` / prefixo `bt-` já estabelecido.

**Diferença fundamental em relação aos beats:** beats são contíguos (ripple trim — cortar uma borda desloca o vizinho); clipes de B-ROLL/TRILHA são **livres** — podem ter espaços vazios, mover pra qualquer posição, cortar cada borda independentemente sem afetar vizinhos. Isso é código de drag novo:

- `startClipMove(track, i, e)` / `doClipMove` — arrastar o corpo do clipe move sua posição (`start`) livremente no tempo, sujeito a snap.
- `startClipTrim(track, i, side, e)` / `doClipTrim` — arrastar a borda esquerda ou direita ajusta `start`+`dur` independentemente (ao contrário do `doBeatTrim`, não mexe em nenhum outro clipe).
- Reaproveita `snapTargets()`/`snapTime()` já existentes (bordas de beat, in/out, playhead) — sem lógica de snap nova, só mais um consumidor.
- **Colisão em B-ROLL**: dois clipes de B-ROLL não podem ocupar o mesmo instante (um cutaway visível de cada vez). Ao arrastar um clipe por cima de outro, o movimento é bloqueado no ponto de colisão (clamp), não empurra o outro clipe.
- **Sobreposição em TRILHA**: permitida sem crossfade — se dois clipes de música se sobrepõem no tempo, tocam simultaneamente (ambos audíveis, sem mixagem especial). Limitação conhecida, documentada na UI se necessário, não resolvida aqui.

**Controles por track** (label column, mesmo padrão `bt-tctl` já usado):
- Hide/Lock em ambas (mesmo comportamento já existente nas 3 tracks atuais).
- Mute/Solo **só** em TRILHA (é a única track nova com áudio real — B-ROLL é mudo por decisão de escopo, então mute/solo nela não teria o que alternar, mesma lógica já aplicada a BEATS/LEGENDA hoje).

### 3. Motor de preview ao vivo

**Preload:** ao adicionar um clipe (B-ROLL ou TRILHA) que referencia uma fonte ainda não carregada, cria um elemento de mídia oculto (`<video>` ou `<audio>`, `preload="auto"`) para essa fonte. Um `Map<path, HTMLMediaElement>` guarda essas instâncias — reaproveitadas se o mesmo arquivo for usado em mais de um clipe. Destruídas (removidas do DOM, `Map` limpo) quando o último clipe que referencia essa fonte é removido.

**Loop de composição** (substitui/estende o `renderPlayhead`/`highlightActiveWord` já existentes, rodando junto no mesmo ciclo de vídeo `timeupdate`/`requestAnimationFrame` já usado pelo transport):
1. Lê o tempo atual do `<video>` principal (relógio mestre, sem mudança em relação ao BEATS de hoje).
2. Determina a camada visual ativa: procura em `BROLL` um clipe cujo `[start, start+dur)` cubra o tempo atual; se achar, essa é a camada; senão, a camada é o vídeo principal.
3. Se a camada ativa for um B-ROLL: garante que seu `<video>` oculto está tocando (`.play()` se pausado), com `currentTime` mantido em sincronia (tempo mestre − `clip.start`) e `.muted = true`; desenha o frame dele no `<canvas>` via `drawImage`. Todo B-ROLL fora de janela fica pausado.
4. Se a camada ativa for o principal: desenha o frame do `<video>` principal no canvas (ele nunca pausa — continua tocando o tempo todo pra manter o áudio de narração contínuo, só não é desenhado quando um B-ROLL está por cima).
5. Para cada clipe de TRILHA ativo no tempo atual: garante que seu `<audio>` está tocando, `currentTime` sincronizado, `.volume` = volume do clipe, `.muted` = estado de mute/solo da track. Fora da janela do clipe, pausado.

**Canvas**: dimensionado pro aspect ratio 9:16 já usado no preview (`.bt-video-wrap`), substitui o `<video id="bt-video">` visível — o `<video>` principal continua existindo no DOM (oculto), fornecendo o relógio mestre e o áudio, só não é mais o elemento visível diretamente.

### 4. Adicionar clipes — picker de assets

Reaproveita o array `assets` (client-side) já populado por upload/geração em VISUALS/VOICE/ASSEMBLE. Um botão "+" no rótulo de cada track nova (B-ROLL, TRILHA) abre um popover — mesmo padrão visual/estrutural do popover de rename dos beats (`.bt-pop`) — listando `assets.filter(a => a.kind === 'video')` (B-ROLL) ou `kind === 'audio'` (TRILHA). Escolher um asset insere um clipe no playhead atual, com duração default de 3s (ou o espaço livre disponível até o próximo clipe/fim da timeline, se menor), que o usuário então arrasta/corta pra posição final.

### 5. Persistência e histórico

`BROLL`/`MUSIC` (arrays de estado, paralelos ao `BEATS` já existente) entram no `snapshot()`/`restore()` do undo/redo já implementado — mesma mecânica, sem histórico separado. `SALVAR BEATS` serializa os 3 arrays juntos no payload v2; `CARREGAR`/autoload (o fix de `window.goStep` já existente) restaura os 3 juntos.

## Erros e degradação

- **Fonte de B-ROLL/TRILHA removida do disco entre sessões** (ex: usuário limpou `jobs/uploads/`): ao carregar um sidecar salvo, se um `path` referenciado não existir mais como asset conhecido na sessão atual, o clipe é mantido nos dados (não perde a posição salva) mas renderizado com um estado visual de "fonte ausente" (sem preload, sem composição — o preview simplesmente não desenha essa camada, cai pro vídeo principal) — mesmo espírito de degradação suave já usado no resto do app (`lib/deps.js`), não trava a UI.
- **`drawImage` de um `<video>` ainda sem frame decodificado** (recém-adicionado, still buffering): pula o frame nesse tick, desenha o frame anterior do canvas (não pisca preto) — checagem via `readyState >= 2` (`HAVE_CURRENT_DATA`) antes de desenhar.
- **Autoplay bloqueado pelo navegador** (política de autoplay com som): já é uma limitação existente do `<video>` principal no BEATS de hoje — mesma UX (usuário dá play manualmente na primeira vez), sem tratamento especial novo pros elementos de B-ROLL/TRILHA além de espelhar o estado de play/pause do relógio mestre.

## Testes/verificação (planejados para a fase de execução)

- Estrutural (sem servidor): `node --check server.js`, sintaxe do `<script>` via `new Function()`, greps de âncora — mesmo padrão usado nos 2 planos anteriores.
- Funcional em navegador real (Chrome via claude-in-chrome, mesmo padrão da verificação do `beat-timeline-editor.md`): upload de 1 vídeo principal + 1 clipe de B-ROLL curto + 1 clipe de áudio de TRILHA, posicionar ambos na timeline, dar play contínuo e confirmar visualmente que o preview troca pro B-ROLL na janela certa e volta, com a música audível por cima da narração; salvar, recarregar página, confirmar que os 3 arrays voltam idênticos.
- Console limpo nos outros steps/tools depois da mudança (mesmo critério dos planos anteriores).

## Cortes explícitos de escopo (YAGNI)

- **Sem in-point de origem**: um clipe de B-ROLL sempre toca a partir do início do arquivo fonte; cortar a borda direita só encurta quanto aparece, não pula pra um trecho do meio do arquivo.
- **Sem crossfade de áudio** entre clipes de TRILHA sobrepostos.
- **Sem tela dividida/headline/legenda customizada** — pertence a uma composição do `remotion/`, não a este editor de timeline.
- **Sem renderização real** — o preview é inteiramente client-side; gerar o MP4 final com os cutaways embutidos fica para um plano de EXPORT futuro, condicionado a este aqui já estar validado.
- **Sem origem automática via `clipper.js`** — todo posicionamento é manual, decisão explícita do usuário.
