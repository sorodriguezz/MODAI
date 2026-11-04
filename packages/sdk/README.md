# @modai/sdk

Cliente HTTP tipado de la API v1 del [servidor MODAI](../../apps/server/README.md). No depende del servidor ni de una base de datos. Es un workspace privado que el build de la CLI incorpora; no se publica en npm.

## Uso

```ts
import { ApiClient } from "@modai/sdk";

const modai = new ApiClient("https://modai.equipo.cl", process.env.MODAI_API_TOKEN);
await modai.assertCompatible();

const projects = await modai.projects();
const bundle = await modai.composeAgent(projects[0].id, "@agents/backend-reviewer");
await modai.remember({ projectId: projects[0].id, content: "Las fechas van en UTC", kind: "decision" });
const results = await modai.searchKnowledge("estado compartido", ["@patterns/frontend-architecture"]);
```

- La URL debe ser `http:` o `https:`, sin credenciales, query ni fragmento. El token se envía como `Authorization: Bearer`.
- Cada petición tiene un límite de 30 segundos y no sigue redirecciones.
- Una respuesta de error lanza `Error` con el mensaje `CODIGO: descripción` que devuelve el servidor (por ejemplo `CAPABILITY_UNSATISFIED: …`).
- La autorización la decide siempre el servidor; el cliente no amplía permisos.

## Métodos

| Área                  | Métodos                                                                                                                                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sesión                | `health`, `session`, `assertCompatible`, `assertCanPublish`                                                                                                                                                                                              |
| Paquetes              | `listPackages`, `catalog`, `getPackage`, `publish`, `validatePackage`, `resolve`, `artifact`, `importSkill`, `deprecate`, `yank`, `hardDelete`, `packageUsage`                                                                                           |
| Templates             | `templates`, `templateInfo`, `templateFiles`, `importTemplate`                                                                                                                                                                                           |
| Conocimiento          | `searchKnowledge`, `knowledgeDocuments`, `createKnowledge`, `updateKnowledge`, `deleteKnowledge`, `saveVector`, `vectorSearch`                                                                                                                           |
| Memoria               | `remember`, `recall`, `listMemories`, `updateMemory`, `deleteMemory`                                                                                                                                                                                     |
| Proyectos             | `projects`, `createProject`, `updateProject`, `deleteProject`, `reportInstallations`                                                                                                                                                                     |
| Organizaciones        | `organizations`, `createOrganization`, `updateOrganization`, `deleteOrganization`, `namespaces`, `createNamespace`, `updateNamespace`, `deleteNamespace`                                                                                                 |
| Categorías            | `categories`, `createCategory`, `updateCategory`, `deleteCategory`                                                                                                                                                                                       |
| Administración        | `users`, `createUser`, `updateUser`, `deleteUser`, `apiKeys`, `createApiKey`, `updateKeyGrants`, `revokeApiKey`, `myApiKeys`, `revokeMyApiKey`, `publishers`, `registerPublisher`, `setPublisherTrust`, `audit`, `exportBackup`, `importBackup`, `prune` |
| Agentes y ejecuciones | `agents`, `capabilities`, `composeAgent`, `submitRun`, `runs`, `run`, `cancelRun`                                                                                                                                                                        |
| Workers               | `claimRun`, `heartbeat`, `finishRun`                                                                                                                                                                                                                     |

`ApiClient` se arma por capas en `src/resources/` (una clase por área que extiende la anterior) sobre `HttpClient` (`src/http-client.ts`). Los tipos compartidos vienen de `@modai/contracts/types`.
