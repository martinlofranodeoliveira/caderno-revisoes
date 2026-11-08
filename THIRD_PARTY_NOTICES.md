# Autoria e recursos de terceiros

O código e a documentação do Caderno de Revisões são disponibilizados sob [MIT](LICENSE), com `Copyright (c) 2026 Contribuidores da LOFRANO TECNOLOGIA`. Os recursos abaixo mantêm suas próprias condições.

## Adaptações da família LOFRANO

A validação de objetos/listas, Unicode, inspeção lexical de JSON e aritmética de datas civis em [src/domain.mjs](src/domain.mjs) foram adaptadas do **Garantia Aberta**; a validação de objetos/listas também tem origem no **Orçamento Aberto**. O adaptador [src/storage.mjs](src/storage.mjs) e seus testes em [tests/storage.test.mjs](tests/storage.test.mjs) foram adaptados do Garantia Aberta.

Esses trechos usam a licença MIT e o aviso `Copyright (c) 2026 Contribuidores da LOFRANO TECNOLOGIA`. A atribuição permanece nos cabeçalhos correspondentes, e o texto integral da licença está em [LICENSE](LICENSE). A identidade visual também herda Lato e as cores da família desses aplicativos.

## Fonte Lato

| Recurso incluído | Licença | Autoria |
| --- | --- | --- |
| `assets/lato-regular.ttf`, `assets/lato-bold.ttf` | SIL Open Font License 1.1 (`OFL-1.1`) | Copyright (c) 2010–2011, Łukasz Dziedzic |

O aviso de autoria e os termos completos acompanham os arquivos em [assets/LATO-LICENSE.txt](assets/LATO-LICENSE.txt). A licença MIT do aplicativo não substitui a licença das fontes. Preserve esse arquivo ao redistribuí-las.

Esse aviso veio do pacote Debian e inclui, separadamente, condições de empacotamento para `debian/*`. Esses arquivos de empacotamento não fazem parte do aplicativo; os dois arquivos de fonte acima permanecem sob OFL-1.1.

## Dependências de desenvolvimento

O navegador não carrega os pacotes npm abaixo, e o build não inclui `node_modules/` em `dist/`. Eles são usados na verificação automatizada. As versões diretas são fixadas em `package.json`, e a árvore exata está em `package-lock.json`.

| Pacote | Versão | Uso | Licença |
| --- | --- | --- | --- |
| [fake-indexeddb](https://github.com/dumbmatter/fakeIndexedDB) | 6.2.7 | Testes de IndexedDB sem navegador | [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) |
| [linkedom](https://github.com/WebReflection/linkedom) | 0.18.15 | DOM para testes de interface | [ISC](https://github.com/WebReflection/linkedom/blob/main/LICENSE) |

O aviso de `linkedom` é `Copyright (c) 2021, Andrea Giammarchi, @WebReflection`. Os termos integrais de cada pacote acompanham a instalação npm em `node_modules/<pacote>/LICENSE`. As dependências transitivas mantêm os avisos e licenças contidos em seus próprios pacotes. Caso redistribua as ferramentas de desenvolvimento, inclua também esses avisos e os termos aplicáveis.
