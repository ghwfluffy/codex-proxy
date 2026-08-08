<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { loginUrl, request } from "./api";

type User={id:string;email:string;displayName:string;isAdmin:boolean;isOwner:boolean};
type Key={id:string;name:string;backend:string;prefix:string;monthlyBudgetMicrousd:number|null;rpm:number;concurrency:number;revokedAt:string|null;createdAt:string};
type Usage={bucket:string;api_key_id:string;backend:string;model:string;requests:number;input_tokens:string;cached_tokens:string;cache_write_tokens:string;output_tokens:string;estimated_cost_microusd:string;avg_duration_ms:number};
const loading=ref(true),error=ref(""),user=ref<User|null>(null),keys=ref<Key[]>([]),usage=ref<Usage[]>([]),newName=ref(""),rawToken=ref(""),codex=ref<any>(null),login=ref<any>(null),connecting=ref(false);
let codexPollTimer:number|undefined,pollAttempts=0;
const activeKeys=computed(()=>keys.value.filter(key=>!key.revokedAt));
const totals=computed(()=>usage.value.reduce((sum,row)=>({requests:sum.requests+Number(row.requests),tokens:sum.tokens+Number(row.input_tokens)+Number(row.output_tokens),cached:sum.cached+Number(row.cached_tokens),cost:sum.cost+Number(row.estimated_cost_microusd)}),{requests:0,tokens:0,cached:0,cost:0}));
const money=(micro:number)=>`$${(micro/1_000_000).toFixed(4)}`;
async function refresh(){error.value="";try{const auth=await request<{authenticated:boolean;user:User|null}>("/auth/me");user.value=auth.user;if(!auth.authenticated)return;[keys.value,usage.value]=await Promise.all([request<{keys:Key[]}>("/keys").then(v=>v.keys),request<{series:Usage[]}>("/usage").then(v=>v.series)]);if(user.value?.isOwner)codex.value=await request("/owner/codex").catch(e=>({connected:false,error:e.message}));}catch(e){error.value=e instanceof Error?e.message:"Request failed"}finally{loading.value=false}}
async function create(){if(!newName.value.trim())return;const result=await request<{key:Key;token:string}>("/keys",{method:"POST",body:JSON.stringify({name:newName.value})});rawToken.value=result.token;newName.value="";await refresh()}
async function revoke(id:string){await request(`/keys/${id}`,{method:"DELETE"});await refresh()}
function stopCodexPolling(){if(codexPollTimer)window.clearTimeout(codexPollTimer);codexPollTimer=undefined;connecting.value=false;pollAttempts=0}
async function pollCodex(){
  if(!connecting.value)return;
  try{const status=await request<any>("/owner/codex");if(status?.account?.account){codex.value=status;login.value=null;stopCodexPolling();return}}catch{}
  pollAttempts+=1;
  if(pollAttempts>=150){stopCodexPolling();error.value="Authorization is taking longer than expected. You can retry without refreshing the page.";return}
  codexPollTimer=window.setTimeout(pollCodex,2000);
}
async function connect(){error.value="";if(connecting.value)return;try{login.value=await request("/owner/codex/login",{method:"POST"});connecting.value=true;pollAttempts=0;codexPollTimer=window.setTimeout(pollCodex,1000)}catch(e){error.value=e instanceof Error?e.message:"Unable to start Codex login"}}
async function copyToken(){await window.navigator.clipboard.writeText(rawToken.value)}
async function logout(){await request("/auth/logout",{method:"POST"});location.reload()}
onMounted(refresh);
onUnmounted(stopCodexPolling);
</script>

<template>
  <main class="shell">
    <header class="topbar">
      <a class="brand" href="./" aria-label="Model Gateway home"><span class="brand-mark"><i></i><i></i><i></i></span><span>Model Gateway</span></a>
      <div class="topbar-meta"><span class="secure"><i></i>Private infrastructure</span><button v-if="user" class="ghost compact" @click="logout">Sign out</button></div>
    </header>
    <div v-if="loading" class="loading"><span></span><p>Loading secure workspace…</p></div>
    <section v-else-if="!user" class="auth-layout">
      <div class="auth-copy">
        <p class="eyebrow">CONTROL PLANE</p>
        <h1>One gateway.<br><em>Every model.</em></h1>
        <p class="lede">Secure access to premium models, with hard spending limits and usage visibility built in.</p>
        <div class="feature-row">
          <div><span class="feature-icon">↗</span><strong>Unified API</strong><small>One OpenAI-compatible endpoint</small></div>
          <div><span class="feature-icon">⌁</span><strong>Usage controls</strong><small>Budgets, quotas, and rate limits</small></div>
          <div><span class="feature-icon">◫</span><strong>Private by design</strong><small>No prompt or response storage</small></div>
        </div>
      </div>
      <aside class="auth-card">
        <div class="card-glow"></div>
        <div class="lock-mark"><span></span></div>
        <p class="eyebrow">AUTHORIZED ACCESS</p>
        <h2>Sign in to continue</h2>
        <p>Use your central account to manage API keys, connect model providers, and inspect usage.</p>
        <a class="button sign-in-button" :href="loginUrl()"><span>Continue with SSO</span><b>→</b></a>
        <p class="auth-note"><i></i>Authentication is handled by your private identity provider.</p>
      </aside>
    </section>
    <template v-else>
      <section class="dashboard-heading"><div><p class="eyebrow">OVERVIEW</p><h1>Model operations</h1><p class="welcome">Signed in as {{ user.displayName }} · {{ user.email }}</p></div><div class="live-badge"><i></i>Live</div></section><p v-if="error" class="error">{{ error }}</p>
      <section class="stats"><article><span>Requests</span><strong>{{ totals.requests }}</strong></article><article><span>Tokens</span><strong>{{ totals.tokens.toLocaleString() }}</strong></article><article><span>Cache hit tokens</span><strong>{{ totals.cached.toLocaleString() }}</strong></article><article><span>Estimated API cost</span><strong>{{ money(totals.cost) }}</strong></article></section>
      <section class="grid">
        <article class="panel"><div class="panel-title"><div><p class="eyebrow">ACCESS</p><h2>API keys</h2></div><span class="count-badge">{{ activeKeys.length }} active</span></div><form @submit.prevent="create"><input v-model="newName" maxlength="120" placeholder="Give this key a name"><button>Create key</button></form><div v-if="rawToken" class="token"><strong>Copy this key now. It will not be shown again.</strong><code>{{ rawToken }}</code><button class="ghost" @click="copyToken">Copy</button></div><div class="table-wrap"><table><thead><tr><th>Name</th><th>Prefix</th><th>Budget</th><th>Limits</th><th></th></tr></thead><tbody><tr v-for="key in activeKeys" :key="key.id"><td><strong>{{key.name}}</strong></td><td><code>{{key.prefix}}…</code></td><td>{{key.monthlyBudgetMicrousd===null?'Subscription':money(key.monthlyBudgetMicrousd)}}</td><td>{{key.rpm}} RPM · {{key.concurrency}} concurrent</td><td><button class="danger" @click="revoke(key.id)">Revoke</button></td></tr><tr v-if="!activeKeys.length"><td colspan="5" class="empty">No active API keys yet.</td></tr></tbody></table></div></article>
        <article v-if="user.isOwner" class="panel"><p class="eyebrow">OWNER BACKEND</p><h2>Codex subscription</h2><div v-if="codex?.account?.account" class="connected"><span></span>Connected · {{codex.account.account.planType??codex.account.account.type}}</div><template v-else><p>Connect the configured owner account with OpenAI’s device authorization flow.</p><button :disabled="connecting" @click="connect">{{connecting?'Waiting for authorization…':'Start device login'}}</button><div v-if="login" class="token"><a :href="login.verificationUrl" target="_blank" rel="noreferrer">Open verification page</a><code>{{login.userCode}}</code><div v-if="connecting" class="connection-wait"><i></i><span>Watching for completion—this page will update automatically.</span></div></div></template><pre v-if="codex?.rateLimits">{{JSON.stringify(codex.rateLimits,null,2)}}</pre></article>
      </section>
      <section class="panel"><div class="panel-title"><div><p class="eyebrow">LAST 90 DAYS</p><h2>Usage by hour, model, and key</h2></div></div><div class="table-wrap"><table><thead><tr><th>Time</th><th>Key</th><th>Backend</th><th>Model</th><th>Requests</th><th>Input</th><th>Cached</th><th>Cache writes</th><th>Output</th><th>Cost</th><th>Latency</th></tr></thead><tbody><tr v-for="row in usage" :key="`${row.bucket}-${row.api_key_id}-${row.model}`"><td>{{new Date(row.bucket).toLocaleString()}}</td><td><code>{{row.api_key_id.slice(0,8)}}</code></td><td>{{row.backend}}</td><td>{{row.model}}</td><td>{{row.requests}}</td><td>{{Number(row.input_tokens).toLocaleString()}}</td><td>{{Number(row.cached_tokens).toLocaleString()}}</td><td>{{Number(row.cache_write_tokens).toLocaleString()}}</td><td>{{Number(row.output_tokens).toLocaleString()}}</td><td>{{money(Number(row.estimated_cost_microusd))}}</td><td>{{row.avg_duration_ms??0}} ms</td></tr><tr v-if="!usage.length"><td colspan="11" class="empty">Usage will appear here after the first request.</td></tr></tbody></table></div></section>
    </template>
  </main>
</template>
