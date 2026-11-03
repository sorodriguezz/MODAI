# Publicar solamente el CLI en npm

El único workspace destinado a npm es `packages/cli` (`@sorodriguez/modai`). Su compilación incorpora el Core, el SDK y los contratos internos. El paquete incluye `modai`, `modai-mcp` y el worker; sus dependencias de ejecución son bibliotecas públicas. No necesita otros paquetes npm de MODAI.

`@modai/contracts`, `@modai/sdk`, `@modai/server`, `@modai/admin` y la raíz declaran `private: true`.

## Publicación automática (GitHub Actions)

[`.github/workflows/npm-publish.yml`](../../.github/workflows/npm-publish.yml) publica la CLI cada vez que llega a `main` un commit que cambia la versión de `packages/cli/package.json`:

1. Si esa versión ya existe en npm, termina sin hacer nada.
2. Comprueba que la versión coincide en todos los archivos que la repiten, instala, compila, ejecuta `npm test`, empaqueta y prueba el paquete instalado.
3. Publica con provenance: una versión estable (`0.7.0`) como `latest`; una prerelease (`0.7.0-beta.1`) como `next`.
4. Crea el tag `v0.7.0`. Un tag creado por el workflow no dispara otros workflows: si quieres también la imagen Docker de esa versión, ejecuta **Imagen Docker** a mano desde la pestaña Actions sobre el tag.

Para lanzar una versión:

```sh
npm run version:set -- 0.8.0      # una sola versión: CLI, Core, contratos, SDK, servidor, panel y package-lock.json
# edita CHANGELOG.md
git commit -am "release: CLI 0.7.0" && git push
```

Configura una sola vez la autenticación con npm (una de las dos):

- **Trusted publishing** (recomendado, sin secretos): en npmjs.com → `@sorodriguez/modai` → Settings → Trusted publisher → GitHub Actions, con el repositorio `sorodriguezz/MODAI` y el workflow `npm-publish.yml`.
- **Token**: crea un token granular con permiso de publicación sobre el paquete y guárdalo en GitHub como secreto `NPM_TOKEN` (Settings → Secrets and variables → Actions).

`npm run check:cli-version` detecta versiones desalineadas antes de hacer push.

## Preparar y comprobar a mano

Con Node 26.13.0:

```sh
npm ci
npm run test:client-package
```

Esto compila y genera `dist/npm/sorodriguez-modai-0.6.0.tgz`, lo instala en un directorio temporal ajeno al monorepo y comprueba CLI, dos clientes con credenciales distintas, memoria compartida autorizada, aislamiento, activación, MCP y worker. `npm test` ejecuta además la suite de integración del servidor.

Revisa el contenido antes de publicar:

```sh
npm publish ./dist/npm/sorodriguez-modai-0.6.0.tgz --access public --dry-run
```

El nombre público es `@sorodriguez/modai`. Publica con una cuenta que tenga permisos sobre el scope `@sorodriguez`. El SDK, los contratos y el servidor conservan sus nombres internos y no se publican.

## Publicar

```sh
npm login
npm whoami
npm publish ./dist/npm/sorodriguez-modai-0.6.0.tgz --access public
```

También puedes publicar desde el workspace; su `prepack` construye contratos, SDK, Core y CLI:

```sh
npm publish --workspace @sorodriguez/modai --access public
```

El usuario instala después:

```sh
npm install -g @sorodriguez/modai
modai server connect https://modai.tu-dominio.cl
```

La publicación no levanta el servidor. El servidor se despliega mediante Docker y tiene su URL propia. Usa una nueva versión del CLI para cada publicación; verifica el nombre y la versión en npm antes del paso público. No se ha publicado ningún paquete durante esta implementación.
