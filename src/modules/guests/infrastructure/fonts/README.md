# Fontes do PDF da exportação

Embutidas no PDF da Exportação de convidados (ADR-39; decisão 194; tela
"Screen / Exportar — PDF / A4" no Penpot). As duas são da SIL Open Font
License 1.1, sem Reserved Font Name; as licenças estão ao lado.

| Arquivo                          | Uso                    | Origem                                                    |
| -------------------------------- | ---------------------- | --------------------------------------------------------- |
| `CormorantGaramond-SemiBold.ttf` | título (display MD 28) | github.com/CatharsisFonts/Cormorant, `fonts/ttf` (v4.002) |
| `NunitoSans-Regular.ttf`         | corpo e células        | github.com/googlefonts/NunitoSans, `fonts/ttf`            |
| `NunitoSans-SemiBold.ttf`        | filtro e nome do grupo | idem                                                      |
| `NunitoSans-Bold.ttf`            | títulos da tabela      | idem                                                      |

Licenças: `OFL-CormorantGaramond.txt` e `OFL-NunitoSans.txt`. O `nest build`
copia esta pasta para o `dist` (nest-cli.json, `assets`).
