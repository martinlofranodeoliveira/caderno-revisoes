# Contribuir com o Caderno de Revisões

O projeto é um aplicativo estático de cartões pessoais. Mudanças devem manter claras a regra de agendamento, a autoria dos textos e avaliações e a situação do salvamento. Não apresente a regra como garantia de aprendizagem.

## Preparar o ambiente

Use Node.js 22 ou superior e npm:

```sh
npm ci
npm run dev
```

O servidor abre em `http://127.0.0.1:4176` e serve `dist/`. Gere novamente após mudanças para atualizar a prévia. Use somente dados sintéticos em testes, capturas e exemplos públicos.

## Onde alterar

| Caminho | Responsabilidade |
| --- | --- |
| `src/domain.mjs` | Validação, datas civis, versões, replay do histórico e regra da agenda |
| `src/io.mjs` | Backup JSON e importação/exportação CSV |
| `src/storage.mjs` | IndexedDB, transações e conflitos de revisão |
| `src/app.mjs` | Estado da interface, confirmação de ações e integração dos adaptadores |
| `index.html`, `assets/app.css` | Estrutura, conteúdo e apresentação da interface |
| `tests/` | Testes do núcleo, formatos, armazenamento e interface |
| `scripts/` | Build, servidor de prévia e verificação dos arquivos públicos |

Leia [PRODUCT.md](PRODUCT.md), [docs/API-CONTRACT.md](docs/API-CONTRACT.md) e [docs/FORMATO.md](docs/FORMATO.md) antes de mudar comportamentos ou formatos.

## Regras que precisam continuar verdadeiras

- O núcleo recebe IDs e datas; não consulta relógio, rede ou armazenamento. Operações retornam um estado novo e não alteram o estado de entrada, inclusive quando falham.
- A agenda é reconstituída das versões e avaliações. Estágio e próxima data não são campos independentes gravados no backup. O replay deve permanecer linear em cartões, versões e avaliações.
- Cada versão admite uma avaliação por dia, a partir do vencimento. Alterar frente ou verso cria uma versão; mover um cartão preserva seu progresso.
- Os graus só aparecem após revelar a resposta. Abrir o próximo cartão depois de uma avaliação não registra outra avaliação. Mudança da data de referência encerra a prática aberta e exige nova abertura.
- Importações são validadas integralmente antes de alterar o caderno. Não descarte campos, linhas ou avaliações inválidas silenciosamente. Não inclua texto privado nas mensagens de erro.
- A leitura de arquivos deve recusar UTF-8 inválido e conferir os limites em bytes antes e depois da leitura. A prévia do CSV também verifica se a inclusão cabe no caderno; o clique de confirmação valida novamente.
- Um backup exportado deve poder ser importado pelo próprio aplicativo, inclusive no limite exato de 8 MiB. CSV preserva sua proteção contra fórmulas; JSON preserva os textos editáveis exatos.
- Gravação e verificação de revisão acontecem na mesma transação IndexedDB. Limpar a cópia usa revisão crescente, para que uma aba antiga não recrie dados silenciosamente.
- Uma falha de armazenamento deve ficar visível, com possibilidade de backup da versão em memória. Não mude silenciosamente para `localStorage` ou outro mecanismo.
- A interface trata textos de cartões como texto simples e continua utilizável por teclado. Confirme substituições e exclusões e preserve mensagens de erro ligadas aos campos.
- Recarregar a cópia salva após conflito mostra sua contagem e exige confirmação antes de trocar a versão em memória. O exemplo exige substituição quando há dados ou nome de caderno personalizado. O desfazer é limitado à última alteração da sessão.

A paginação de 50 registros serve à exibição; não introduza um teto diário de prática ao reutilizar esse valor.

Uma mudança incompatível no JSON exige decidir e documentar a versão do esquema e a migração. Não altere o significado de `schemaVersion: 1` nem a regra de replay de históricos existentes sem tratar essa compatibilidade.

## Verificar uma mudança

```sh
npm test
npm run build
npm run check
```

Para prévia da saída já gerada:

```sh
npm run preview
```

Acrescente testes quando mudar regra, validação, formatos ou transações, cobrindo o comportamento que poderia falhar. Para uma alteração visual simples, confira a tela no navegador, por teclado e em largura pequena; não crie testes que apenas repitam a implementação.

Se a mudança atingir importação, confirme também que um arquivo inválido não aplica parcialmente os registros. Se atingir armazenamento, confira o conflito entre duas conexões e a preservação da versão em memória após erro. Mudanças no CSV devem manter os casos de aspas, células com múltiplas linhas, BOM, limites UTF-8 e proteção contra fórmulas.

## Enviar uma proposta

Abra uma issue ou pull request no [repositório](https://github.com/martinlofranodeoliveira/caderno-revisoes). Descreva o problema concreto, o comportamento resultante e como foi verificado. Para problemas de interface, inclua passos de reprodução e capturas com conteúdo fictício. Para vulnerabilidades, siga [SECURITY.md](SECURITY.md).

Não inclua backups pessoais, dados do navegador, credenciais, arquivos de contas, diretórios locais de trabalho ou documentos privados. `node_modules/` e `dist/` são gerados e não devem ser versionados. Preserve os avisos de autoria e licença ao adaptar código ou recursos.

Ao enviar uma contribuição, você concorda em disponibilizá-la sob a [licença MIT do projeto](LICENSE), respeitando as licenças dos recursos de terceiros.
