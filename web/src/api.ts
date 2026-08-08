const appBase=(import.meta.env.VITE_APP_BASE_PATH??"").replace(/\/$/,"");
const apiBase=(import.meta.env.VITE_API_BASE_URL??`${appBase}/api/v1`).replace(/\/$/,"");

export async function request<T>(path:string, options:RequestInit={}):Promise<T>{
  const response=await fetch(`${apiBase}${path}`,{credentials:"same-origin",...options,headers:{...(options.body?{"content-type":"application/json"}:{}),...options.headers}});
  if(!response.ok){const payload=await response.json().catch(()=>({}));throw new Error(payload?.error?.message??`HTTP ${response.status}`)}
  if(response.status===204)return undefined as T;
  return response.json() as Promise<T>;
}
export const loginUrl=()=>`${apiBase}/auth/login?next=${encodeURIComponent("/")}`;
