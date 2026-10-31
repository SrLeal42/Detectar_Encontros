O Desafio: Detecção de Encontros
Seu objetivo é desenvolver um algoritmo capaz de processar dados de geolocalização e detectar encontros físicos entre duas entidades:

Monitorados/Agressores: Indivíduos utilizando tornozeleiras eletrônicas.

Vítimas: Pessoas com medidas protetivas utilizando rastreadores portáteis.

Tipos de encontros a serem detectados:

Encontros genéricos: Encontro entre quaisquer dois monitorados.

Encontros de facções: Encontro entre dois monitorados que pertencem à mesma facção.

Encontros de medidas protetivas: Encontro entre um agressor e sua respectiva vítima.

Regras de Negócio e Requisitos Técnicos
Tecnologia obrigatória: JavaScript ou TypeScript (utilizando Node.js ou frameworks similares).

Utilização de IA: A utilização de ferramentas de inteligência artificial É PERMITIDO, porém será avaliada principalmente a forma de utilização das ferramentas bem como a defesa da solução na resposta do desafio e em etapas futuras do processo. O mais importante é saber o que está construindo!

Distância limite: O raio para configurar um encontro é de 20 metros (distância menor que 20 metros).

Cálculo de distância: Utilizar a Fórmula de Haversine, considerando o raio da Terra como 6.371.000 metros.

Análise de Timestamps: Os posicionamentos são gerados a cada 5 segundos (ex: 2026-10-01 00:00:00, 2026-10-01 00:00:05). Você deve comparar apenas os posicionamentos que possuem o exato mesmo timestamp.

Unicidade: Cada encontro deve ser registrado apenas uma vez por par de envolvidos naquele timestamp (a ordem dos IDs das pessoas monitoradas no array do resultado não impacta a solução).

Datsets de Input
Você encontrará abaixo os links de 7 datasets em formato .txt.

Os 2 primeiros contêm as respostas corretas para você validar sua lógica. Os 5 restantes são os datasets oficiais que usaremos para avaliar e pontuar sua solução. Os datasets de testes contém os respectivos arquivos JSON de resposta.

Formato do Input: Os arquivos de entrada utilizam separação por ponto e vírgula (;), no estilo CSV, com o seguinte cabeçalho e estrutura de campos:

idMonitorado;faccaoMonitorado;timestamp;latitude;longitude;medidaProtetiva;idsRestricaoMedida

idMonitorado: Define o id da pessoa monitorada, podendo ser usuário de tornozeleira ou vítima de medida protetiva.

faccaoMonitorado: Define o id da facção do monitorado (pode ser vazio; apenas usuários de tornozeleira possuem esse campo preenchido).

timestamp: Data do posicionamento no formato YYYY-MM-DD HH:MM:SS.

latitude: Latitude do posicionamento no formato float com 5 casas decimais.

longitude: Longitude do posicionamento no formato float com 5 casas decimais.

medidaProtetiva: Booleano que indica se a pessoa monitorada tem medida protetiva ou não.

idsRestricaoMedida: Array de Ids dos monitorados agressores, caso a pessoa possua medida protetiva, no formato "1,2,3,...n".

Formato do Output
Para cada dataset processado, sua aplicação deve gerar um arquivo JSON contendo um array com os encontros detectados, seguindo estritamente a estrutura abaixo:

JSON
  [{
    "tipo": "faccao", 
    "monitoradosEncontro": [40, 44],
    "timestamp": "2024-01-01 00:01:50",
    "posicoes": { 
      "40": { "lat": -10.07996, "lon": -37.08384 }, 
      "44": { "lat": -10.07987, "lon": -37.08389 } 
    },
    "distanciaMetros": 11.406788673336607
  }]
(Valores aceitos para o campo "tipo": generico, faccao, protetiva)

Pontuação e Avaliação
A pontuação final do desafio será calculada com base na seguinte fórmula:

Score = soma_ec - soma_ei

(Sendo soma_ec a somatória dos encontros corretamente detectados e soma_ei a somatória dos encontros incorretos/falsos positivos em todos os arquivos de output).

Critério de desempate: Será considerada a soma do tempo médio de execução do algoritmo para cada dataset. Soluções mais eficientes e performáticas terão vantagem.

O que você deve nos entregar
Responda diretamente a este e-mail contendo:

Código-fonte completo da sua solução.

Arquivo README.md descrevendo a lógica utilizada, como executar o projeto e por que você considera esta a melhor abordagem para o problema.

Arquivos de Output (JSONs) gerados pelo seu algoritmo para os datasets que você conseguiu resolver.

Atenção ao envio: Provedores de e-mail costumam bloquear anexos com extensões .js ou .ts. Para garantir que receberemos sua entrega, envie todos os arquivos compactados (.zip) ou forneça um link seguro para download (Google Drive, GitHub, OneDrive, etc.).

Início do desafio e Prazo
Os datasets serão liberados na data de hoje 30/10/2026 às 18:00:00!

O prazo máximo para envio da sua solução é dia 03/11/2026, às 23:59:59.

E-mails recebidos após este horário não serão considerados.

Caso envie mais de um e-mail dentro do prazo, avaliaremos apenas a última versão recebida.