# Mapa 3D do Inbound — Cloudflare

Aplicativo 3D para consulta de endereços/posições e materiais do Almoxarifado SLMB.

## Arquitetura

- **Frontend 3D:** HTML + Three.js, preservando a estrutura visual do protótipo original.
- **Backend:** Cloudflare Worker (`src/index.js`).
- **Persistência compartilhada:** Cloudflare D1 (`inventory_positions`, `app_meta`, `import_history`).
- **Atualização:** um usuário autorizado importa a planilha ZMM023 pelo próprio aplicativo. O navegador interpreta o Excel, valida as posições e envia a base ao Worker. O Worker substitui a base oficial em uma operação em lote e grava uma nova versão.
- **Consulta:** todos os usuários carregam a mesma versão do D1. A última base também fica em `localStorage` apenas como cache para abrir mais rápido ou continuar consultando quando a internet oscilar.
- **Bibliotecas:** o navegador pede `/vendor/...` ao mesmo domínio do aplicativo. O Worker busca as bibliotecas permitidas e as mantém em cache na borda da Cloudflare, reduzindo dependência direta de CDNs nos computadores da empresa.

## O que já está pronto

- Pesquisa por endereço (ex.: `ZC01`).
- Pesquisa por código de material ou descrição.
- Destaque de resultados no mapa 3D.
- Painel lateral com materiais, descrição e quantidade.
- Visões por rua e visão superior.
- Modo calor e alternância de rótulos.
- Layout responsivo para desktop e celular.
- Clique/toque em posições do mapa.
- Indicador de sincronização e data/hora da última atualização.
- Cache local com atualização central.
- Importação de Excel protegida por chave administrativa.
- Histórico das últimas importações no banco (endpoint `/api/status`).
- Persistência independente de novos deploys do site.

## Formato da planilha

O importador procura uma coluna de posição/endereço com nomes como:

`Posição`, `Posicao`, `POSICAO`, `Posição SAP`, `Endereço`, `Endereco`, `Pos. depósito`, `BIN` ou `Storage Bin`.

Para o material, procura `Material`, `Código`, `Codigo` ou `Cod`.

Para descrição, procura `Descrição`, `Descricao`, `DESC` ou `Material Desc`.

Para quantidade, procura `Qtde total`, `Qtde`, `Quantidade`, `Qtd` ou `QTDE`.

A importação só grava posições existentes no mapa e ignora posições marcadas como desativadas.

## Publicação no Cloudflare

### 1. Instalar dependências

No terminal, dentro desta pasta:

```bash
npm install
npx wrangler login
```

### 2. Criar o banco D1

```bash
npx wrangler d1 create mapa-3d-inbound-db
```

O comando mostrará um `database_id`. Abra `wrangler.toml` e substitua:

```toml
database_id = "COLE_AQUI_O_DATABASE_ID"
```

pelo ID real.

### 3. Criar as tabelas

```bash
npm run db:remote
```

### 4. Criar a chave para atualização da planilha

```bash
npx wrangler secret put ADMIN_KEY
```

Digite uma senha/chave forte quando o terminal solicitar. Ela **não** fica no HTML nem no GitHub.

### 5. Publicar

```bash
npm run deploy
```

O Wrangler mostrará o endereço `*.workers.dev` publicado.

## Atualização diária da base

1. Abra o aplicativo publicado.
2. Clique em **Atualizar Planilha**.
3. Digite a chave de atualização.
4. Selecione/arraste a planilha ZMM023.
5. Aguarde a mensagem **Base publicada!**.

A partir desse momento, a nova versão estará disponível para qualquer outro usuário que abrir/recarregar o aplicativo, independentemente do computador ou local.

## Segurança

A consulta é pública para quem tiver o endereço do site. A alteração da base exige `ADMIN_KEY` no Worker. Para uma etapa futura, é possível colocar o site inteiro ou apenas a atualização atrás de Cloudflare Access/SSO corporativo.

## Observação importante

O D1 é o banco oficial. O cache do navegador nunca substitui o banco; ele serve somente para velocidade e contingência de internet. Um novo deploy do Worker/HTML não apaga os dados do D1.
