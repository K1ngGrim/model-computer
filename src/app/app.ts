import {AfterViewInit, Component, ElementRef, inject, model, OnInit, signal, viewChild} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import {FormsModule} from '@angular/forms';
import {NgForOf, NgIf} from '@angular/common';
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
  imports: [RouterOutlet, FormsModule, NgIf, NgForOf],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements AfterViewInit {
  protected readonly title = signal('ModelComputer');


  private readonly compiler = inject(CompilerService);


  private readonly editorContainer = viewChild<ElementRef<HTMLDivElement>>('editormonaco')
  editor!: monaco.editor.IStandaloneCodeEditor;

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
      automaticLayout: true
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

  protected readonly codeValue = model<string>();

  // --- UI State ---
  sourceCode = model<string>(`LDI 5\nSTA 10\nHLT`); // Default Platzhalter
  statusMessage = signal('System bereit. Warte auf Code...');

  // Die Hardware-Register (Initialwerte)
  cpu = signal<CpuState>({
    acc: 0,
    regB: 0,
    pc: 0,
    ir: 0,
    flags: { z: false, n: false, c: false }
  });

  // Speicher-Arrays (16 Plätze, initialisiert mit 0)
  instructionRam = signal<number[]>(new Array(16).fill(0));
  dataRam = signal<number[]>(new Array(16).fill(0));

  isRunning = signal(false);
  logs: string[] = ['UI initialisiert. Logik fehlt noch.'];

  private timer: any;

  // --- UI Helper (Formatierung) ---

  formatBin(val: number): string {
    // Gibt 4-Bit Binärstring zurück
    return (val >>> 0).toString(2).padStart(4, '0');
  }

  formatHex(val: number): string {
    return '0x' + (val >>> 0).toString(16).toUpperCase();
  }

  log(msg: string) {
    const time = new Date().toLocaleTimeString().split(' ')[0];
    this.logs.unshift(`[${time}] ${msg}`);
  }

  // --- LOGIK-STUBS (Hier musst du programmieren) ---

  assemble() {
    this.log('TODO: Implementiere Assembler-Logik hier.');
    // TODO:
    // 1. this.sourceCode() zeilenweise lesen
    // 2. Opcode parsen
    // 3. Ergebnis in this.instructionRam.set([...]) schreiben
  }

  reset() {
    this.log('Reset gedrückt.');
    // TODO: CPU Status zurücksetzen
    this.cpu.set({
      acc: 0, regB: 0, pc: 0, ir: 0,
      flags: { z: false, n: false, c: false }
    });
    this.stop();
  }

  step() {
    this.log('Step gedrückt (Noch keine Logik).');
    // TODO:
    // 1. Fetch: IR = InstructionRam[PC]
    // 2. PC inkrementieren
    // 3. Execute: switch(IR >> 4) ...
    // 4. Update CPU Signal: this.cpu.set(...)
    // 5. Update RAM Signal: this.dataRam.set(...)
  }

  // Simpler Loop für Run/Stop
  toggleRun() {

    const s = this.compiler.compile(this.editor!.getValue()) as ParseResult;
    console.log(s);
    this.run(s.ast);
  }

  run(ast: Instruction[]){

    while (true) {
      const cpu = this.cpu();

      const pc = cpu.pc;
      const acc = cpu.acc;

      if (pc < 0 || pc >= ast.length) {
        this.log('Programmende erreicht oder ungültige PC-Adresse.');
        break;
      }

      const instruction = ast[pc];

      console.log(instruction.inst, pc, acc);

      if (instruction.inst === 'NOP') {
        // nothing to do
      } else if (instruction.inst === 'LDA') {
        const immediateValue = extractImmediateValue(instruction) ?? 0;

        this.cpu.update(cpu => {
          cpu.acc = this.mask4Bit(immediateValue);
          // Set Flags
          cpu.flags.z = (cpu.acc === 0);
          cpu.flags.n = ((cpu.acc & 0x08) !== 0); // Check MSB for negative
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
        continue;

      } else if (instruction.inst === 'BRZ') {
        if (cpu.flags.z) {
          const immediateValue = extractImmediateValue(instruction) ?? 0;

          this.cpu.update(cpu => {
            cpu.pc = this.mask4Bit(cpu.pc + immediateValue);
            return cpu;
          });
          continue;
        }
      } else if (instruction.inst === 'BRC') {
        if (cpu.flags.c) {
          const immediateValue = extractImmediateValue(instruction) ?? 0;

          this.cpu.update(cpu => {
            cpu.pc = this.mask4Bit(cpu.pc + immediateValue);
            return cpu;
          });
          continue;
        }

      } else if (instruction.inst === 'BRN') {
        if (cpu.flags.n) {
          const immediateValue = extractImmediateValue(instruction) ?? 0;

          this.cpu.update(cpu => {
            cpu.pc = this.mask4Bit(cpu.pc + immediateValue);
            return cpu;
          });
          continue;
        }
      }

      // Increment PC if not modified by instruction
      this.cpu.update(cpu => {
        cpu.pc = this.mask4Bit(cpu.pc + 1);
        return cpu;
      });
    }



  }

  stop() {
    this.isRunning.set(false);
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }


  shift(val: number, bits: number, direction: 'left' | 'right' = 'right'): number {
    if (direction === 'left') {
      return (val << bits) & 0x0F;

    }else if (direction === 'right') {
      return (val >> bits) & 0x0F;
    }

    return val & 0x0F;
  }

  mask4Bit(val: number): number {
    return val & 0x0F;
  }

}

interface CpuState {
  acc: number;  // Akkumulator
  regB: number; // Hilfsregister
  pc: number;   // Program Counter
  ir: number;   // Instruction Register
  flags: {
    z: boolean; // Zero
    n: boolean; // Negative
    c: boolean; // Carry
  };
}
