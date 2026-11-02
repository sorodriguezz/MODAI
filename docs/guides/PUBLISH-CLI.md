# Publicar solamente el CLI en npm

El único workspace destinado a npm es `packages/cli` (`@sorodriguez/modai`). Su compilación incorpora el SDK y los contratos internos. El paquete incluye `modai`, `modai-mcp` y el worker; sus dependencias de ejecución son bibliotecas públicas. No necesita otros paquetes npm de MODAI.

`@modai/contracts`, `@modai/sdk`, `@modai/server`, `@modai/admin` y la raíz declaran `private: true`.

## Preparar y comprobar

Con Node 26.13.0:

```sh
npm ci
npm run test:client-package
```

Esto compila y genera `dist/npm/sorodriguez-modai-0.5.0.tgz`, lo instala en un directorio temporal ajeno al monorepo y comprueba CLI, dos clientes con credenciales distintas, memoria compartida autorizada, aislamiento, activación, MCP y worker. `npm test` ejecuta además la suite de integración del servidor.

Revisa el contenido antes de publicar:

```sh
npm publish ./dist/npm/sorodriguez-modai-0.5.0.tgz --access public --dry-run
```

El nombre público es `@sorodriguez/modai`. Publica con una cuenta que tenga permisos sobre el scope `@sorodriguez`. El SDK, los contratos y el servidor conservan sus nombres internos y no se publican.

## Publicar

```sh
npm login
npm whoami
npm publish ./dist/npm/sorodriguez-modai-0.5.0.tgz --access public
```

También puedes publicar desde el workspace; su `prepack` construye los contratos, SDK y CLI:

```sh
npm publish --workspace @sorodriguez/modai --access public
```

El usuario instala después:

```sh
npm install -g @sorodriguez/modai
modai connect https://modai.tu-dominio.cl
```

La publicación no levanta el servidor. El servidor se despliega mediante Docker y tiene su URL propia. Usa una nueva versión del CLI para cada publicación; verifica el nombre y la versión en npm antes del paso público. No se ha publicado ningún paquete durante esta implementación.
