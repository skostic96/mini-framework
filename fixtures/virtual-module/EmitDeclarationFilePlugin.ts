import type { Compiler } from '@rspack/core';
import path from 'node:path';
// This import is required for compatibility reasons, typescript 7 dropped
// compiler api completely
// https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
import * as ts from '@typescript/typescript6';

export class EmitEntryDeclarationFilePlugin {
  entry: string;
  outName: string;

  constructor(option: { entry: string; outName: string }) {
    this.entry = option.entry;
    this.outName = option.outName;
  }

  apply(compiler: Compiler) {
    const { Compilation, sources } = compiler.rspack;

    compiler.hooks.thisCompilation.tap(
      'EmitEntryDeclarationFilePlugin',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'EmitEntryDeclarationFilePlugin',
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
          },
          () => {
            const file = this.entry;

            const configPath = ts.findConfigFile(
              path.dirname(file),
              ts.sys.fileExists,
            );

            if (!configPath) {
              compilation.errors.push(
                new Error(
                  `EmitEntryDeclarationFilePlugin: unable to find tsconfig file.`,
                ),
              );
              return;
            }

            const parsed = ts.getParsedCommandLineOfConfigFile(
              configPath,
              {
                declaration: true,
                emitDeclarationOnly: true,
                noEmit: false,
              },
              {
                ...ts.sys,
                onUnRecoverableConfigFileDiagnostic: (d) => {
                  compilation.errors.push(
                    new Error(
                      `EmitEntryDeclarationFilePlugin: ${String(d.messageText)}`,
                    ),
                  );
                },
              },
            );

            const program = ts.createProgram([file], parsed.options);

            const sourceFile = program.getSourceFile(file);
            if (!sourceFile) {
              compilation.errors.push(
                new Error(
                  `EmitEntryDeclarationFilePlugin: ${file} not in program.`,
                ),
              );
              return;
            }

            program.emit(
              sourceFile,
              (_, text) => {
                compilation.emitAsset(
                  this.outName,
                  new sources.RawSource(text),
                );
              },
              undefined,
              true,
            );
          },
        );
      },
    );
  }
}
