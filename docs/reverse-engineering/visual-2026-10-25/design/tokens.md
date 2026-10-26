# Design tokens

Theme studied: claro. Capturas de referência inspecionadas:1920×855, DPR1. Valores abaixo são **amostras observadas**, não tokens globais inferidos nem medição de todos estados. Fonte: [EV-202-account-ref.json](../evidence/EV-202-account-ref.json), campos controls/headings/panels. Outras famílias devem ser verificadas individualmente.

## Color

| Amostra | Valor observado | Uso | Evidence |
|---|---|---|---|
| Primary | rgb(255,107,0) | Salvar/nav ativa | EV-202-account-ref.json |
| Primary tint | rgba(255,107,0,0.08) | Nav Conta ativa | EV-202-account-ref.json |
| Text | rgb(17,24,39) | Heading/campos | EV-202-account-ref.json |
| Secondary text | rgb(75,85,99) | Nav inativa | EV-202-account-ref.json |
| Border panel | rgb(229,231,235) | Seções | EV-202-account-ref.json |
| Border input | rgb(209,213,219) | Campos | EV-202-account-ref.json |
| Surface | rgb(255,255,255) | Painel/input | EV-202-account-ref.json |

## Typography

| Amostra | Family | Size | Weight | Line height | Evidence |
|---|---|---|---|---|---|
| Conta H1 | Exo2 / Exo2 Fallback / sans-serif |24px |700 |30px | EV-202-account-ref.json |
| Seção H2 | Exo2 / Exo2 Fallback / sans-serif |16px |600 |20px | EV-202-account-ref.json |
| Corpo/input | Manrope / fallback / system |16px |400 |24px | EV-202-account-ref.json |
| Nav ativa/inativa | Manrope |14px |500/400 |20px | EV-202-account-ref.json |
| Botão Salvar | Manrope |14px |500 |20px | EV-202-account-ref.json |
| Botão pequeno/ajuda | Manrope |12px |500 |16px | EV-202-account-ref.json |

## Spacing, radius and geometry

| Amostra | Valor | Contexto | Evidence |
|---|---|---|---|
| Input/select | h46; radius8; padding10px12px | Conta; select padding-right40px | EV-202-account-ref.json |
| Botão primário | h36; radius8; padding horizontal16px | Salvar | EV-202-account-ref.json |
| Botão pequeno | h32; radius8; padding horizontal12px | Trocar foto/Salvar cobrança | EV-202-account-ref.json |
| Nav item | h32; w208; radius8; padding6px10px | Settings | EV-202-account-ref.json |
| Nav ajuda | h30; w208; padding6px10px; gap6px | Como funciona esta área | EV-202-account-ref.json |
| Panels Conta | x532; w1152; radius12 | Perfil y194/h442; Contatos y656/h607; Relatórios y1283/h304 | EV-202-account-ref.json |
| Conta H1 | x532/y116 | Mesmo viewport de referência | EV-202-account-ref.json |
| Campos em2 colunas | x553 e1116; w547 cada | Conta | EV-202-account-ref.json |

## Motion, layers, icons and breakpoints

Não medidos de forma suficiente nesta revisão documental. JSONs de geometria base não comprovam duração/easing/z-index nem comportamento mobile. Registrar capturas e estados específicos antes de definir tokens globais ou breakpoints.

## Comparação local

EV-218-dashboard-before.json usa viewport2133×994/DPR~0.9; EV-219-dashboard-ref.json usa1920×855/DPR1. Essa dupla é baseline descritivo, não comparação aceita. Repetir local em viewport/escala equivalentes. Preservar decisões comerciais explícitas ao comparar copy.
