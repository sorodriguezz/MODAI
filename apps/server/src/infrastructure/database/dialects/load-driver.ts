function isMissingModule(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND";
}

export async function loadDriver<M>(load: () => Promise<M>, driver: string, engine: string): Promise<M> {
  try {
    return await load();
  } catch (error) {
    if (isMissingModule(error))
      throw new Error(
        `Falta el driver "${driver}" para ${engine}. Instálalo en el servidor con: npm install ${driver} -w @modai/server`,
      );
    throw error;
  }
}
