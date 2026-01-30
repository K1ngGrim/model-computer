import {AfterViewInit, Component, ElementRef, input, model, OnChanges, SimpleChanges, viewChild} from '@angular/core';
import * as monaco from 'monaco-editor'
import {editor} from 'monaco-editor';
import IEditorDecorationsCollection = editor.IEditorDecorationsCollection;

@Component({
  selector: 'app-code-editor',
  imports: [],
  templateUrl: './code-editor.html',
  styleUrl: './code-editor.scss',
})
export class CodeEditor implements AfterViewInit, OnChanges {

  public readonly content = model<string>('');
  public readonly isReadOnly = input<boolean>(false);

  public readonly editorContainer = viewChild<ElementRef<HTMLDivElement>>('editormonaco')
  editor!: monaco.editor.IStandaloneCodeEditor;

  private debugDecorations!: IEditorDecorationsCollection;

  public ngOnChanges(changes: SimpleChanges): void {
    if (changes['isReadOnly']) {
      if (this.editor) {
        this.editor.updateOptions({ readOnly: this.isReadOnly() });
      }
    }
  }

  public ngAfterViewInit() {
    this.registerAsmLanguage();

    if (!this.editorContainer()) {
      return;
    }

    this.editor = monaco.editor.create(this.editorContainer()!.nativeElement, {
      value: this.content(),
      language: 'asm',
      theme: 'vs-dark',
      scrollBeyondLastLine: false,
      scrollbar: {
        vertical: 'hidden',
        horizontal: 'hidden',
        handleMouseWheel: false,
        alwaysConsumeMouseWheel: true
      },
      mouseWheelScrollSensitivity: 0,
      fastScrollSensitivity: 0,
      minimap: { enabled: false },
      allowOverflow: false,
      automaticLayout: true,
    });

    this.editor.onDidChangeModelContent(() => {
      const code = this.editor.getValue();
      this.content.set(code);
    });

    this.debugDecorations = this.editor.createDecorationsCollection();
  }

  setDebugLine(line: number) {
    this.debugDecorations.set([]);
    this.debugDecorations.set([
      {
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          linesDecorationsClassName: "dbgGlyph",
          className: "dbgLine",
        },
      },
    ]);

    this.editor.revealLineInCenterIfOutsideViewport(line);
  }

  public reformatCode() {
    const unformattedCode = this.editor.getValue();
    const formattedCode = unformattedCode
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n');
    this.editor.setValue(formattedCode);
  }

  registerAsmLanguage() {
    monaco.languages.register({ id: 'asm' });

    monaco.languages.setMonarchTokensProvider('asm', {
      tokenizer: {
        root: [
          [/;.*/, 'comment'],
          [/\b(NOP|STA|LDA|ADD|SUB|JMP|BRZ|BRC|BRN)\b/i, 'keyword'],
          [/\b(\d+|\(\d+\))\b/, 'variable'],
          [/\b#(0x[0-9A-Fa-f]+|\d+)\b/, 'number'],
          [/^[A-Za-z_][\w]*:/, 'type'],
          [/:[A-Za-z_]\w*/, 'type.label']
        ]
      }
    });
  }

}
