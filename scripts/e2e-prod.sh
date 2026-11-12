#!/usr/bin/env bash
#
# Validação ponta a ponta da saga da OS contra o ambiente publicado (OS +
# Billing + gateway fake de pagamento). Cada cenário abre uma OS nova, leva
# o diagnóstico até o orçamento e exercita um desfecho da saga.
#
# Compatível com o bash 3.2 do macOS: corpos JSON são montados com `jq -n`
# em variáveis (JSON com vírgula inline dentro de "$( ... )" sofre brace
# expansion no 3.2).
set -euo pipefail

usage() {
  cat <<'EOF'
Uso: scripts/e2e-prod.sh [--help]

Variáveis de ambiente:
  API_BASE       URL base do stage (default: https://7eu2kz40xj.execute-api.us-east-1.amazonaws.com/prod)
  OS_EMAIL       e-mail do usuário staff (obrigatória)
  OS_PASSWORD    senha do usuário staff (obrigatória; nunca é impressa)
  STEP_TIMEOUT   segundos máximos de espera por passo (default: 30)
  POLL_INTERVAL  segundos entre consultas (default: 2)
  SCENARIOS      cenários a rodar, separados por espaço (default: "feliz reprovado recusado")
                   feliz     aprova orçamento, paga no checkout, saga CONCLUIDA
                   reprovado reprova orçamento, OS REPROVADA, saga COMPENSADA
                   recusado  aprova orçamento, recusa no checkout, saga PENDENTE
  CHECK_DLQ      1 verifica a fila oficina-billing-dlq via aws CLI (default: 1;
                 ignorado se o aws CLI não estiver instalado)
  CLIENTE_ID     (opcional) cliente existente; sem isso um cliente é criado
  VEICULO_ID     (opcional) veículo existente do CLIENTE_ID; sem isso um é criado

Sai com código != 0 no primeiro passo que falhar.
EOF
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  "") ;;
  *) echo "argumento desconhecido: $1" >&2; usage >&2; exit 2 ;;
esac

API_BASE="${API_BASE:-https://7eu2kz40xj.execute-api.us-east-1.amazonaws.com/prod}"
API_BASE="${API_BASE%/}"
STEP_TIMEOUT="${STEP_TIMEOUT:-30}"
POLL_INTERVAL="${POLL_INTERVAL:-2}"
SCENARIOS="${SCENARIOS:-feliz reprovado recusado}"
CHECK_DLQ="${CHECK_DLQ:-1}"
DLQ_NAME="oficina-billing-dlq"

for dep in curl jq; do
  command -v "$dep" >/dev/null 2>&1 || { echo "✖ dependência ausente: $dep (instale antes de rodar)" >&2; exit 2; }
done
: "${OS_EMAIL:?✖ defina OS_EMAIL (usuário staff do serviço de OS)}"
: "${OS_PASSWORD:?✖ defina OS_PASSWORD (usuário staff do serviço de OS)}"

TOKEN=""
LAST_BODY=""
LAST_CODE=""
STEP_START=$(date +%s)
PASSED=0
SUMMARY=""

now() { date +%s; }

begin() { STEP_START=$(now); }

ok() {
  local el=$(( $(now) - STEP_START ))
  printf '  ✔ %s (%ss)\n' "$1" "$el"
  PASSED=$((PASSED + 1))
  SUMMARY="${SUMMARY}  ✔ $1"$'\n'
}

fail() {
  local el=$(( $(now) - STEP_START ))
  printf '  ✖ %s (%ss)\n' "$1" "$el" >&2
  SUMMARY="${SUMMARY}  ✖ $1"$'\n'
  if [ -n "${2:-}" ]; then
    printf '    último payload: %s\n' "$2" >&2
  fi
  printf '\n== resumo\n%s\nfalhou após %s passo(s) ok\n' "$SUMMARY" "$PASSED" >&2
  exit 1
}

# api METODO PATH [BODY_JSON] -> LAST_BODY, LAST_CODE (usa TOKEN se houver)
api() {
  local method="$1" path="$2" body="${3:-}" out
  local args=(-sS --max-time 20 -X "$method" -w $'\n%{http_code}' "${API_BASE}${path}")
  [ -n "$TOKEN" ] && args+=(-H "authorization: Bearer $TOKEN")
  if [ -n "$body" ]; then
    args+=(-H 'content-type: application/json' -d "$body")
  fi
  if ! out=$(curl "${args[@]}" 2>&1); then
    LAST_BODY="${out%$'\n'*}"; LAST_CODE="000"; return 0
  fi
  LAST_CODE="${out##*$'\n'}"
  LAST_BODY="${out%$'\n'*}"
}

# expect_2xx DESCRICAO
expect_2xx() {
  case "$LAST_CODE" in
    2??) ;;
    *) fail "$1 (HTTP $LAST_CODE)" "$LAST_BODY" ;;
  esac
}

jget() { printf '%s' "$LAST_BODY" | jq -r "$1" 2>/dev/null || true; }

# poll DESCRICAO PATH JQ_FILTER_BOOLEAN  -> espera filtro == true
poll() {
  local desc="$1" path="$2" filter="$3" deadline res
  deadline=$(( $(now) + STEP_TIMEOUT ))
  while :; do
    api GET "$path"
    if [ "$LAST_CODE" = "200" ]; then
      res=$(printf '%s' "$LAST_BODY" | jq -r "$filter" 2>/dev/null || true)
      if [ "$res" = "true" ]; then return 0; fi
    fi
    if [ "$(now)" -ge "$deadline" ]; then
      fail "$desc: timeout de ${STEP_TIMEOUT}s (HTTP $LAST_CODE)" "$LAST_BODY"
    fi
    sleep "$POLL_INTERVAL"
  done
}

# Filtros jq sobre o GET /os/:id/saga ({status, passos:[{nome,status}]}).
saga_passo() { # nome status
  printf '(.passos // []) | any(.nome == "%s" and .status == "%s")' "$1" "$2"
}
saga_status() { printf '.status == "%s"' "$1"; }

# --- autenticação --------------------------------------------------------
login() {
  local body
  begin
  body=$(jq -n --arg e "$OS_EMAIL" --arg p "$OS_PASSWORD" '{email:$e,password:$p}')
  TOKEN=""
  api POST /auth/login "$body"
  expect_2xx "login staff"
  TOKEN=$(jget '.accessToken // empty')
  [ -n "$TOKEN" ] || fail "login staff: resposta sem accessToken" ""
  ok "login staff"
}

# CPF válido aleatório (11 dígitos) para o cliente de teste.
gen_cpf() {
  local d i s r d1 d2
  d=()
  for i in 0 1 2 3 4 5 6 7 8; do d+=($((RANDOM % 10))); done
  s=0; for i in 0 1 2 3 4 5 6 7 8; do s=$((s + d[i] * (10 - i))); done
  r=$((s * 10 % 11)); [ "$r" -ge 10 ] && r=0; d1=$r
  s=0; for i in 0 1 2 3 4 5 6 7 8; do s=$((s + d[i] * (11 - i))); done
  s=$((s + d1 * 2))
  r=$((s * 10 % 11)); [ "$r" -ge 10 ] && r=0; d2=$r
  printf '%s%s%s%s%s%s%s%s%s%s%s' "${d[0]}" "${d[1]}" "${d[2]}" "${d[3]}" "${d[4]}" "${d[5]}" "${d[6]}" "${d[7]}" "${d[8]}" "$d1" "$d2"
}

gen_placa() {
  local L=ABCDEFGHJKLMNPRSTUVXZ
  printf '%s%s%s%s%s%s%s' "${L:$((RANDOM % 21)):1}" "${L:$((RANDOM % 21)):1}" "${L:$((RANDOM % 21)):1}" \
    $((RANDOM % 10)) "${L:$((RANDOM % 21)):1}" $((RANDOM % 10)) $((RANDOM % 10))
}

ensure_cliente_veiculo() {
  local body
  begin
  if [ -n "${CLIENTE_ID:-}" ] && [ -n "${VEICULO_ID:-}" ]; then
    ok "cliente/veículo informados por env"
    return 0
  fi
  body=$(jq -n --arg d "$(gen_cpf)" '{nome:"E2E Saga Prod",documento:$d,email:"e2e-saga@example.com"}')
  api POST /clientes "$body"
  expect_2xx "criar cliente"
  CLIENTE_ID=$(jget '.id // empty')
  [ -n "$CLIENTE_ID" ] || fail "criar cliente: resposta sem id" "$LAST_BODY"
  body=$(jq -n --arg c "$CLIENTE_ID" --arg p "$(gen_placa)" \
    '{clienteId:$c,placa:$p,marca:"Fiat",modelo:"Uno",ano:2020}')
  api POST /veiculos "$body"
  expect_2xx "criar veículo"
  VEICULO_ID=$(jget '.id // empty')
  [ -n "$VEICULO_ID" ] || fail "criar veículo: resposta sem id" "$LAST_BODY"
  ok "cliente e veículo criados"
}

# --- fluxo comum: OS -> orçamento aguardando aprovação -------------------
OS_ID=""
ORC_ID=""

preparar_os() {
  local body sid pid
  sid=$(printf '%08x-0000-4000-8000-%012x' "$RANDOM$RANDOM" "$RANDOM$RANDOM")
  pid=$(printf '%08x-0000-4000-8000-%012x' "$RANDOM$RANDOM" "$RANDOM$RANDOM")
  begin
  # Itens na abertura (precoUnitario/quantidade) para valorTotal > 0.
  body=$(jq -n --arg c "$CLIENTE_ID" --arg v "$VEICULO_ID" --arg s "$sid" --arg p "$pid" \
    '{clienteId:$c,veiculoId:$v,descricaoProblema:"E2E saga prod",
      servicos:[{servicoId:$s,precoUnitario:150}],
      pecas:[{pecaId:$p,quantidade:2,precoUnitario:50}]}')
  api POST /os "$body"
  expect_2xx "criar OS"
  OS_ID=$(jget '.id // empty')
  [ -n "$OS_ID" ] || fail "criar OS: resposta sem id" "$LAST_BODY"
  ok "OS criada ($OS_ID)"

  begin
  api PATCH "/os/$OS_ID/iniciar-diagnostico"
  expect_2xx "iniciar diagnóstico"
  api PATCH "/os/$OS_ID/concluir-diagnostico"
  expect_2xx "concluir diagnóstico"
  ok "diagnóstico concluído"

  begin
  poll "saga no passo APROVAR_ORCAMENTO" "/os/$OS_ID/saga" "$(saga_passo APROVAR_ORCAMENTO EM_ANDAMENTO)"
  ok "saga aguardando APROVAR_ORCAMENTO"

  begin
  poll "orçamento da OS" "/billing/orcamentos/by-os/$OS_ID" '.id != null'
  ORC_ID=$(jget '.id')
  if [ "$(jget '(.valorTotal // 0) > 0')" != "true" ]; then
    printf '  ⚠ valorTotal do orçamento não é > 0 (%s)\n' "$(jget '.valorTotal')"
  fi
  ok "orçamento $ORC_ID gerado (valorTotal=$(jget '.valorTotal'))"
}

aprovar_orcamento() {
  begin
  api PATCH "/billing/orcamentos/$ORC_ID/aprovar"
  expect_2xx "aprovar orçamento"
  ok "orçamento aprovado"
}

# Espera a cobrança (checkoutUrl) e devolve a URL absoluta em CHECKOUT_URL.
CHECKOUT_URL=""
aguardar_checkout() {
  begin
  poll "saga solicitando cobrança (passo COBRAR)" "/os/$OS_ID/saga" "$(saga_passo COBRAR EM_ANDAMENTO)"
  ok "saga no passo COBRAR"
  begin
  poll "cobrança com checkoutUrl" "/billing/cobrancas/by-os/$OS_ID" '(.checkoutUrl // "") != ""'
  CHECKOUT_URL=$(jget '.checkoutUrl')
  case "$CHECKOUT_URL" in
    http://*|https://*) ;;
    /*) CHECKOUT_URL="${API_BASE}${CHECKOUT_URL}" ;;
    *) fail "checkoutUrl em formato inesperado" "$CHECKOUT_URL" ;;
  esac
  ok "checkout disponível"
}

# POST {checkoutUrl}/aprovar|recusar (formulário do gateway fake).
decidir_checkout() {
  local acao="$1" code
  begin
  code=$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' -X POST \
    -H 'content-type: application/x-www-form-urlencoded' -d '' "${CHECKOUT_URL%/}/$acao") \
    || fail "checkout $acao: falha de rede" ""
  case "$code" in
    2??) ok "checkout $acao (HTTP $code)" ;;
    *) fail "checkout $acao (HTTP $code)" "" ;;
  esac
}

# --- cenários ------------------------------------------------------------
cenario_feliz() {
  preparar_os
  aprovar_orcamento
  aguardar_checkout
  decidir_checkout aprovar
  begin
  poll "saga CONCLUIDA" "/os/$OS_ID/saga" "$(saga_status CONCLUIDA) and ($(saga_passo CONFIRMAR CONCLUIDO))"
  ok "saga CONCLUIDA (CONFIRMAR concluído)"
  begin
  poll "cobrança CONFIRMADA" "/billing/cobrancas/by-os/$OS_ID" '.status == "CONFIRMADA"'
  ok "cobrança CONFIRMADA"
}

cenario_reprovado() {
  local body
  preparar_os
  begin
  body=$(jq -n '{motivo:"E2E: reprovado pelo cliente"}')
  api PATCH "/billing/orcamentos/$ORC_ID/reprovar" "$body"
  expect_2xx "reprovar orçamento"
  ok "orçamento reprovado"
  begin
  poll "saga COMPENSADA" "/os/$OS_ID/saga" "$(saga_status COMPENSADA)"
  ok "saga COMPENSADA"
  begin
  poll "OS REPROVADA" "/os/$OS_ID" '.status == "REPROVADA"'
  ok "OS em REPROVADA"
}

cenario_recusado() {
  preparar_os
  aprovar_orcamento
  aguardar_checkout
  decidir_checkout recusar
  begin
  poll "saga PENDENTE" "/os/$OS_ID/saga" "$(saga_status PENDENTE)"
  ok "saga PENDENTE (pagamento recusado)"
  begin
  poll "cobrança RECUSADA" "/billing/cobrancas/by-os/$OS_ID" '.status == "RECUSADA"'
  ok "cobrança RECUSADA"
}

# --- DLQ -----------------------------------------------------------------
checar_dlq() {
  local url n
  [ "$CHECK_DLQ" = "1" ] || return 0
  if ! command -v aws >/dev/null 2>&1; then
    echo "  - aws CLI ausente: verificação da DLQ ignorada"
    return 0
  fi
  begin
  url=$(aws sqs get-queue-url --queue-name "$DLQ_NAME" --query QueueUrl --output text 2>/dev/null) \
    || { echo "  - não consegui resolver a fila $DLQ_NAME (credenciais/região?): verificação ignorada"; return 0; }
  n=$(aws sqs get-queue-attributes --queue-url "$url" \
    --attribute-names ApproximateNumberOfMessages \
    --query 'Attributes.ApproximateNumberOfMessages' --output text 2>/dev/null) \
    || { echo "  - get-queue-attributes falhou: verificação ignorada"; return 0; }
  if [ "$n" = "0" ]; then
    ok "DLQ $DLQ_NAME vazia"
  else
    fail "DLQ $DLQ_NAME tem $n mensagem(ns)" ""
  fi
}

# --- main ----------------------------------------------------------------
echo "== e2e saga OS/Billing em $API_BASE (cenários: $SCENARIOS)"
login
ensure_cliente_veiculo

for sc in $SCENARIOS; do
  printf '\n== cenário: %s\n' "$sc"
  SUMMARY="${SUMMARY}[$sc]"$'\n'
  case "$sc" in
    feliz) cenario_feliz ;;
    reprovado) cenario_reprovado ;;
    recusado) cenario_recusado ;;
    *) fail "cenário desconhecido: $sc" "" ;;
  esac
done

printf '\n== DLQ\n'
checar_dlq

printf '\n== resumo\n%s\ntodos os passos ok (%s)\n' "$SUMMARY" "$PASSED"
