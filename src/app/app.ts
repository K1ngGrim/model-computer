import {AfterViewInit, Component, ElementRef, inject, model, OnInit, signal, viewChild} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import {FormsModule} from '@angular/forms';
import {NgClass, NgForOf, NgIf} from '@angular/common';
import * as monaco from 'monaco-editor'
import {
  ASTNode,
  CompilerService,
  extractImmediateValue, extractRegisterRef, Instruction,
  InstructionType,
  ParseResult
} from './services/compiler-service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, FormsModule, NgIf, NgForOf, NgClass],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements AfterViewInit {

  private readonly editorContainer = viewChild<ElementRef<HTMLDivElement>>('editormonaco')
  editor!: monaco.editor.IStandaloneCodeEditor;

  private readonly compiler = inject(CompilerService);

  private readonly buildResult = signal<ParseResult | null>(null);
  private readonly debugPoints = signal<Set<number>>(new Set());
  protected readonly codeValue = model<string>();

  instructionRam = signal<number[]>(new Array(16).fill(0));
  dataRam = signal<number[]>(new Array(16).fill(0));

  protected readonly cpu = signal<CpuState>({
    acc: 0,
    pc: 0,
    ir: 0,
    flags: { z: false, n: false, c: false }
  });

  ngAfterViewInit() {
    this.registerAsmLanguage();

    if (!this.editorContainer()) {
      return;
    }

    this.editor = monaco.editor.create(this.editorContainer()!.nativeElement, {
      value: `LDA #1
:loop ADD #2
SUB #1
STA 15
BRN #2
JMP loop`,
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
      console.log(code);
    });
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

  public build() {
    const s = this.compiler.compile(this.editor!.getValue()) as ParseResult;
    this.buildResult.set(s);
  }

  public run(){

    if (!this.buildResult()) return;

    const ast = this.buildResult()!.ast;

    while (true) {
      const cpu = this.cpu();

      const pc = cpu.pc;

      if (pc < 0 || pc >= ast.length) {
        this.log('Programmende erreicht oder ungültige PC-Adresse.');
        break;
      }

      if (this.debugPoints().has(pc + 1)) {
        this.log(`Debug Halt bei PC=${pc}`);
        break;
      }

      const instruction = ast[pc];

      const branched = this.execInstruction(instruction);

      if (!branched) {
        this.cpu.update(cpu => {
          cpu.pc = this.mask4Bit(cpu.pc + 1);
          return cpu;
        });
      }

    }



  }

  public step(){
    if (!this.buildResult()) return;

    const cpu = this.cpu();
    const pc = cpu.pc;

    const ast = this.buildResult()!.ast;

    const instruction = ast[pc];

    const branched = this.execInstruction(instruction);

    if (!branched) {
      this.cpu.update(cpu => {
        cpu.pc = this.mask4Bit(cpu.pc + 1);
        return cpu;
      });
    }
  }

  public execInstruction(instruction: Instruction){
    const cpu = this.cpu();

    if (instruction.inst === 'NOP') {
      return false;
    } else if (instruction.inst === 'LDA') {
      const immediateValue = extractImmediateValue(instruction) ?? 0;

      this.cpu.update(cpu => {
        cpu.acc = this.mask4Bit(immediateValue);
        cpu.flags.z = (cpu.acc === 0);
        cpu.flags.n = ((cpu.acc & 0x08) !== 0);
        return cpu;
      });

    } else if (instruction.inst === 'LDA_R') {
      const registerValue = extractRegisterRef(instruction) ?? 0;
      const immediateValue = this.dataRam()[registerValue];

      this.cpu.update(cpu => {
        cpu.acc = this.mask4Bit(immediateValue);
        // Set Flags
        cpu.flags.z = (cpu.acc === 0);
        cpu.flags.n = ((cpu.acc & 0x08) !== 0); // Check MSB for negative
        return cpu;
      });

    } else if (instruction.inst === 'STA_R') {
      const registerValue = extractRegisterRef(instruction) ?? 0;
      const accValue = this.cpu().acc;

      this.dataRam.update(ram => {
        ram[registerValue] = this.mask4Bit(accValue);
        return ram;
      });

    } else if (instruction.inst === 'ADD') {
      const immediateValue = extractImmediateValue(instruction) ?? 0;

      this.cpu.update(cpu => {
        cpu.acc = this.mask4Bit(cpu.acc + immediateValue);
        // Set Flags
        cpu.flags.z = (cpu.acc === 0);
        cpu.flags.n = ((cpu.acc & 0x08) !== 0); // Check MSB for negative
        return cpu;
      });

    } else if (instruction.inst === 'ADD_R') {
      // handle ADD_R

    } else if (instruction.inst === 'SUB') {
      const immediateValue = extractImmediateValue(instruction) ?? 0;

      this.cpu.update(cpu => {
        cpu.acc = this.mask4Bit(cpu.acc - immediateValue);
        // Set Flags
        cpu.flags.z = (cpu.acc === 0);
        cpu.flags.n = ((cpu.acc & 0x08) !== 0); // Check MSB for negative
        return cpu;
      });

    } else if (instruction.inst === 'SUB_R') {
      // handle SUB_R

    } else if (instruction.inst === 'JMP') {
      const immediateValue = extractImmediateValue(instruction) ?? 0;

      this.cpu.update(cpu => {
        cpu.pc = this.mask4Bit(immediateValue);
        return cpu;
      });
      return true;

    } else if (instruction.inst === 'BRZ') {
      if (cpu.flags.z) {
        const immediateValue = extractImmediateValue(instruction) ?? 0;

        this.cpu.update(cpu => {
          cpu.pc = this.mask4Bit(cpu.pc + immediateValue);
          return cpu;
        });
        return true;
      }
    } else if (instruction.inst === 'BRC') {
      if (cpu.flags.c) {
        const immediateValue = extractImmediateValue(instruction) ?? 0;

        this.cpu.update(cpu => {
          cpu.pc = this.mask4Bit(cpu.pc + immediateValue);
          return cpu;
        });
        return true;
      }

    } else if (instruction.inst === 'BRN') {
      if (cpu.flags.n) {
        const immediateValue = extractImmediateValue(instruction) ?? 0;

        this.cpu.update(cpu => {
          cpu.pc = this.mask4Bit(cpu.pc + immediateValue);
          return cpu;
        });
        return true;
      }
    }

    return false;
  }

  formatBin(val: number): string {
    // Gibt 4-Bit Binärstring zurück
    return (val >>> 0).toString(2).padStart(4, '0');
  }

  formatHex(val: number): string {
    return '0x' + (val >>> 0).toString(16).toUpperCase();
  }

  log(msg: string) {
    const time = new Date().toLocaleTimeString().split(' ')[0];
    //this.logs.unshift(`[${time}] ${msg}`);
  }

  reset() {
    this.cpu.set({
      acc: 0, pc: 0, ir: 0,
      flags: { z: false, n: false, c: false }
    });
  }

  mask4Bit(val: number): number {
    return val & 0x0F;
  }

}

interface CpuState {
  acc: number;  // Akkumulator
  pc: number; // Programmzähler
  ir: number;   // Instruction Register
  flags: {
    z: boolean; // Zero
    n: boolean; // Negative
    c: boolean; // Carry
  };
}
