const placeholder = (name: string) => `\${${name}}`;

export const PACKAGE_DIR_PLACEHOLDER = placeholder("packageDir");
export const PROJECT_DIR_PLACEHOLDER = placeholder("projectDir");
