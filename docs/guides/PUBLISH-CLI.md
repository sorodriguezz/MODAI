# Publicar solamente el CLI en npm

El único workspace destinado a npm es `packages/cli` (`@modai/cli`). Su compilación incorpora el SDK y los contratos internos. El paquete incluye `modai`, `modai-mcp` y el worker; sus dependencias de ejecución son bibliotecas públicas. No necesita otros paquetes npm de MODAI.

`@modai/contracts`, `@modai/sdk`, `@modai/server`, `@modai/admin` y la raíz declaran `private: true`.

## Preparar y comprobar

Con Node 26.13.0:

```sh
npm ci
npm run test:client-package
```

Esto compila y genera `dist/npm/modai-cli-0.5.0.tgz`, lo instala en un directorio temporal ajeno al monorepo y comprueba CLI, dos clientes con credenciales distintas, memoria compartida autorizada, aislamiento, activación, MCP y worker. `npm test` ejecuta además la suite de integración del servidor.

Revisa el contenido antes de publicar:

```sh
npm publish ./dist/npm/modai-cli-0.5.0.tgz --access public --dry-run
```

Necesitas controlar el scope `@modai` en npm. Si no es tuyo, cambia el nombre público del CLI y las referencias a ese workspace en scripts y documentación antes de construir y regenerar el lockfile. Los nombres de los paquetes internos pueden conservarse.

## Publicar

```sh
npm login
npm whoami
npm publish ./dist/npm/modai-cli-0.5.0.tgz --access public
```

También puedes publicar desde el workspace; su `prepack` construye los contratos, SDK y CLI:

```sh
npm publish --workspace @modai/cli --access public
```

El usuario instala después:

```sh
npm install -g @modai/cli
modai connect https://modai.tu-dominio.cl
```

La publicación no levanta el servidor. El servidor se despliega mediante Docker y tiene su URL propia. Usa una nueva versión del CLI para cada publicación; verifica el estado del scope y la versión en npm antes del paso público. No se ha publicado ningún paquete durante esta implementación.
