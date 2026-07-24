# Design — Melhorias no proxy de curva de atenção (Score / Step 05)

**Data:** 2026-07-24
**Arquivo-alvo principal:** `lib/score.js` (`proxyCurve` + helpers), com ajuste de UI em `public/index.html` (`doScore`).
**Restrições:** zero dependência npm no backend; usar apenas `ffmpeg`/`ffprobe` + transcript já disponível. Preservar o contrato de callbacks (`onLog`/`onStage`/`onProgress`) e o job bus.

## Contexto e problema

O `proxyCurve` atual (tier B do Score, quando não há `STUDIO_TRIBE_CMD`) combina três sinais por segundo:

- `audioEnergy` — RMS/s via `ffmpeg astats`
- `visualChange` — contagem de cortes de cena (`select=gt(scene,0.18)`) por segundo
- `speech` — contagem de word-starts/s a partir do transcript

Blend: `0.45·energy + 0.30·cuts + 0.25·speech` (com fala) ou `0.6·energy + 0.4·cuts` (sem fala); média móvel de 3s; detecção de dip abaixo de `mean − 0.18`.

Fraquezas identificadas para uso como **termômetro geral de retenção** de Reels verticais:

1. **Sinal visual só reage a CORTES.** Um plano dinâmico sem cortes pontua igual a um frame congelado — a forma da curva não reflete dinamismo dentro do plano.
2. **Sem peso no hook.** O segundo 0 é tratado igual ao segundo 30, mas retenção de Reels se ganha/perde nos primeiros ~3s.
3. **Silêncio morto é neutro, não penalizado.** Dead-air (sem fala + baixa energia) é o maior gatilho de scroll e hoje só pontua baixo passivamente.
4. **Normalização min/max é sensível a outliers.** Um único pico de áudio achata o resto da curva, prejudicando a leitura da forma e a comparação entre reels.

## Objetivo

Elevar a fidelidade do sinal de atenção/retenção e dar ao usuário uma leitura de "termômetro" (forma da curva + nota geral + veredito de hook), mantendo backend zero-dep e o mesmo contrato de saída (campos novos são aditivos e retrocompatíveis).

**Fora de escopo:** TRIBE v2 (tier A) permanece inalterado; qualquer refatoração não relacionada; mudanças no job bus ou nas rotas do `server.js`.

## Abordagem escolhida

**Melhoria focada no lugar.** Todas as mudanças dentro de `proxyCurve` e seus helpers em `lib/score.js`, mantendo o arquivo único e a assinatura pública (`score`, `proxyCurve`, `TRIBE_INFO`). Um único passo ffmpeg novo (movimento contínuo), rodado em paralelo com os passos existentes.

Alternativas descartadas:
- **Refatorar em módulos de sinal separados** — over-engineering (YAGNI); não há plano de adicionar muitos sinais.
- **Versão mínima (só normalização + dead-air)** — deixaria de fora o movimento contínuo, o maior ganho de fidelidade e explicitamente pedido.

## Desenho detalhado

### 1. Sinais por segundo (sobre `dur = ceil(duration)`)

| Sinal | Fonte | Estado |
| --- | --- | --- |
| `energy` | `audioEnergy(file, duration)` — RMS/s via `ffmpeg astats` | mantém, sem mudança |
| `cuts` | `visualChange(file, duration)` — `select=gt(scene,0.18)` count/s | mantém, sem mudança |
| **`motion`** | **novo** `motionMagnitude(file, duration)` | adicionar |
| `speech` | word-starts/s do transcript | mantém, sem mudança |

**`motionMagnitude(file, duration)` (novo helper):**
- Comando: `ffmpeg -hide_banner -i <file> -vf "scale=64:64,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-" -f null -`
- Parse: mesma mecânica de `audioEnergy` — casar `pts_time:([\d.]+)` e `lavfi.signalstats.YAVG=([\d.]+)`, agregando a **média** dos YAVG por segundo (não max), em `perSec = new Array(ceil(duration))`.
- Segundos sem amostra → `0`.
- `.catch(() => '')` como os outros, para degradar suave (retorna array de zeros se ffmpeg falhar).
- Roda dentro do mesmo `Promise.all` de `audioEnergy` e `visualChange`.

### 2. Blend

```
nE = normalize(energy)
nC = normalize(cuts.map(c => Math.min(c, 3)))     // mantém o clamp existente de cortes
nM = normalize(motion)
nS = normalize(speech)

visual = nC.map((c, i) => 0.5 * c + 0.5 * nM[i])

base[i] = hasSpeech
  ? 0.40 * nE[i] + 0.35 * visual[i] + 0.25 * nS[i]
  : 0.55 * nE[i] + 0.45 * visual[i]
```

**Penalidade dead-air** (aplicada sobre `base`, antes do smoothing):
```
DEADAIR_ENERGY = 0.2     // limiar de energia normalizada
DEADAIR_FACTOR = 0.5     // multiplicador de penalidade
curve[i] = (speech[i] === 0 && nE[i] < DEADAIR_ENERGY) ? base[i] * DEADAIR_FACTOR : base[i]
```
Constantes nomeadas no topo do módulo (ou como const locais claras), para ajuste fácil.

### 3. Normalização robusta (substitui `normalize`)

Trocar min/max cru por clamp de percentil:
```
// sorted = array ordenado asc; p em [0,100]. Interpolação linear entre ranks:
//   idx = (p/100) * (sorted.length - 1)
//   lo = floor(idx), hi = ceil(idx)
//   return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
// (array de 1 elemento → retorna esse elemento; sem NaN)
function percentile(sorted, p) { ... }
function normalize(arr) {
  const sorted = [...arr].sort((a,b) => a-b);
  const lo = percentile(sorted, 5), hi = percentile(sorted, 95);
  if (hi - lo < 1e-6) return arr.map(() => 0.5);
  return arr.map(v => Math.max(0, Math.min(1, (v - lo) / (hi - lo))));
}
```
Mantém o mesmo nome/assinatura (`normalize(arr) -> number[]` em 0–1), então os call-sites não mudam. Comportamento de array flat preservado (retorna 0.5).

### 4. Smoothing + dips

Sem mudança: média móvel de 3s (`smooth`), `mean`, e detecção de dip (`smooth[i] < mean − 0.18`, com merge de dips adjacentes). Os dips continuam no output com o mesmo formato e `advice`.

### 5. Saídas novas (aditivas, retrocompatíveis)

Computadas a partir de `smooth` (a curva final):

**`score` (0–100):** média ponderada da curva com **hook 2×**.
```
HOOK_SECONDS = 3
weight[i] = i < HOOK_SECONDS ? 2 : 1
score = Math.round(100 * Σ(smooth[i]*weight[i]) / Σ(weight[i]))
```

**`hook`:** `{ value, weak, advice }`
```
hookVal = média de smooth[0 .. min(HOOK_SECONDS, len)-1]
weak = hookVal < 0.5 || hookVal < mean * 0.9
hook = {
  value: +hookVal.toFixed(3),
  weak,
  advice: weak
    ? 'hook fraco — reforce os primeiros 3s (corte mais forte, primeira fala mais direta, movimento)'
    : 'hook forte — a abertura segura a atenção'
}
```

**Objeto de retorno de `proxyCurve`** (campos existentes inalterados; `score` e `hook` adicionados):
```
{
  kind: 'proxy',
  note: <string existente>,
  duration, curve, mean,       // inalterados
  score,                       // novo — inteiro 0–100
  hook,                        // novo — { value, weak, advice }
  dips                         // inalterado
}
```
`score()` (o orquestrador) continua anexando `proxy.tribe = TRIBE_INFO` como hoje.

### 6. UI (`public/index.html`, apenas `doScore`)

Antes da tabela de dips, renderizar dois chips a partir de `r.score` e `r.hook`:
- Chip de retenção: `retention ${r.score}/100` (classe `ok` se `score >= 60`, senão `wn`).
- Chip de hook: classe `ok` + texto "hook forte" se `!r.hook.weak`; classe `bad`/`wn` + "hook fraco — reforce os 3s iniciais" se `r.hook.weak`.
- Guardas: só renderiza cada chip se o campo existir (`r.score != null`, `r.hook`), para não quebrar caso o resultado venha do TRIBE (que não emite esses campos).

`drawCurve` permanece sem alteração.

## Custo / desempenho

Um passo ffmpeg adicional (motion), downscaled a 64×64 → rápido, e paralelizado no `Promise.all` existente junto de energy/cuts. Sem novas dependências. Sem mudança no contrato do job bus.

## Critérios de aceite (verificáveis)

1. `lib/score.js` exporta ainda `{ score, proxyCurve, TRIBE_INFO }` (assinatura pública intacta).
2. Existe helper `motionMagnitude` que dispara o comando ffmpeg com `tblend=all_mode=difference` e `signalstats`/`YAVG`, e é incluído no `Promise.all` de sinais.
3. `normalize` usa percentil p5–p95 (verificável por inspeção: ordena o array e chama `percentile`), e ainda retorna `0.5` para arrays flat.
4. A penalidade dead-air aplica `*0.5` quando `speech[i]===0 && nE[i]<0.2` (verificável por inspeção do código).
5. Rodar `POST /api/score` num clipe de teste retorna JSON com: `curve` não-vazia; `score` inteiro em `[0,100]`; `hook` com `value` numérico e `weak` booleano; `dips` no formato atual; `kind:'proxy'`.
6. Verificação de robustez da normalização: injetar/observar que um único segundo de energia muito alta não zera (achata para ~0) os demais segundos — a curva mantém variação visível (comparação antes/depois no mesmo clipe).
7. Na UI (Chrome, Step 05), após RUN ATTENTION CURVE aparecem os dois chips novos (retention NN/100 e status de hook) acima da tabela de dips; curva e dips seguem renderizando.

## Status

_(propriedade do Executor — updates incrementais durante a implementação)_
