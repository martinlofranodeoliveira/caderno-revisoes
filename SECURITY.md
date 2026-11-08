# Segurança e privacidade

O Caderno de Revisões executa no navegador. Conteúdo dos cartões, versões e avaliações ficam na memória da aba ou, quando você ativa a opção correspondente, em IndexedDB. Não há conta, sincronização em nuvem ou envio dos cartões a um serviço de IA.

## O que proteger

- **Perfil do navegador:** os dados locais não são criptografados. Quem acessa o perfil, extensões com permissões suficientes ou código da mesma origem pode acessá-los.
- **Origem de hospedagem:** o armazenamento é separado por protocolo, domínio e porta, não pelo caminho. Aplicativos em `https://martinlofranodeoliveira.github.io/` compartilham a origem, mesmo em repositórios diferentes. Nomes distintos de banco não criam isolamento de segurança. Para isolamento entre aplicativos, use uma origem exclusiva.
- **Backups e relatórios:** JSON e CSV são arquivos de texto sem criptografia. O JSON contém também versões antigas, arquivados e histórico. O CSV de histórico contém a frente avaliada; excluir o verso desse relatório não o torna anônimo.
- **Persistência:** IndexedDB não substitui backup. O navegador pode apagar dados, atingir a quota ou bloquear o acesso. Antes de limpar dados, trocar de perfil ou atualizar uma cópia própria, guarde um JSON fora do navegador.

O aplicativo não faz chamadas de rede para transmitir o caderno. O provedor que serve HTML, CSS, JavaScript e fontes pode receber os dados normais de uma requisição web. Links externos abertos pela pessoa seguem as políticas de seus destinos.

## Proteções implementadas

O JSON tem esquema fechado, limites de tamanho e profundidade, referências validadas e recusa de chaves repetidas. O histórico é reexecutado durante a validação, incluindo vencimento e sequência das avaliações. A importação não aplica parte de um arquivo inválido.

A interface confere o tamanho dos arquivos antes e depois da leitura e usa decodificação UTF-8 que recusa bytes inválidos. CSV passa também por uma tentativa de inclusão sem alterar o estado antes de mostrar a confirmação. Restaurar JSON e carregar a cópia salva após conflito exigem confirmação antes de substituir a versão em memória.

Os textos são conteúdo simples, sem HTML. A página define uma política de conteúdo com `connect-src 'none'`, usa recursos locais e não carrega dependências de execução no navegador. Essa política reduz superfícies de execução e transmissão; ela não substitui o controle sobre os arquivos publicados ou sobre a origem que os hospeda.

As exportações CSV prefixam com apóstrofo os valores que podem ser tratados como fórmulas por planilhas, inclusive com certos espaços ou formas Unicode antes do sinal. Esse tratamento altera o texto exportado nesses casos. Use JSON para uma cópia exata e tenha cuidado ao remover o apóstrofo em uma planilha.

O armazenamento usa comparação de revisão e gravação na mesma transação. A limpeza mantém uma revisão crescente com documento nulo, evitando que uma aba antiga sobrescreva ou restaure silenciosamente uma versão anterior. Falhas de quota, bloqueio, corrupção e conflito são informadas; a versão em memória continua disponível para backup. Essas revisões detectam concorrência, mas não autenticam quem acessa a mesma origem.

## Relatar uma vulnerabilidade

Consulte a [área de segurança do repositório](https://github.com/martinlofranodeoliveira/caderno-revisoes/security) e use **Report a vulnerability** se o relato privado estiver disponível. Se não houver canal privado habilitado, abra uma issue apenas solicitando um canal de contato, sem publicar detalhes exploráveis ou dados pessoais.

Em um relato privado, informe a versão ou commit, navegador, passos mínimos com dados fictícios e o impacto observado. Não envie seu IndexedDB, backups pessoais, credenciais ou conteúdo real de cartões. Uma amostra sintética que reproduza a falha costuma ser suficiente.

Correções são feitas na versão atual do repositório. Não há compromisso de manutenção de versões antigas nem prazo garantido de resposta. Para falhas funcionais sem impacto de segurança, use as [issues](https://github.com/martinlofranodeoliveira/caderno-revisoes/issues).
