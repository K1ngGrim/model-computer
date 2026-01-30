import {inject, Injectable, signal} from '@angular/core';
import {
  CompilerService,
  extractImmediateValue,
  extractRegisterRef,
  Immediate,
  Instruction,
  ParseResult, RegisterRef
} from './compiler-service';
import {LoggingService} from './logging-service';

@Injectable({
  providedIn: 'root',
})
export class ProcessorService {

  private readonly compiler = inject(CompilerService);
  private readonly logger = inject(LoggingService);

  public readonly isDebugMode = signal(false);

  public readonly isRunning = signal(false);

  private readonly instructionRam = signal<number[]>(new Array(16).fill(0));
  private readonly dataRam = signal<number[]>(new Array(16).fill(0));
  public readonly buildResult = signal<ParseResult | null>(null);

  public readonly cpu = signal<CpuState>({
    acc: 0,
    pc: 0,
    ir: 0,
    flags: { z: false, n: false, c: false }
  });

  public programmCounter() {
    const cpu = this.cpu();
    return cpu.pc;
  }

  public readInstructionRam() {
    return this.instructionRam();
  }

  public readDataRam() {
    return this.dataRam();
  }

  public execInstruction(instruction: Instruction){
    const cpu = this.cpu();

    if (instruction.inst === 'NOP') {
      return false;
    } else if (instruction.inst === 'LDA') {
      const immediateValue = extractImmediateValue(instruction) ?? 0;

      this.cpu.update(cpu => {
        cpu.acc = mask4Bit(immediateValue);
        cpu.flags.z = (cpu.acc === 0);
        cpu.flags.n = ((cpu.acc & 0x08) !== 0);
        return cpu;
      });

    } else if (instruction.inst === 'LDA_R') {
      const registerValue = extractRegisterRef(instruction) ?? 0;
      const immediateValue = this.dataRam()[registerValue];

      this.cpu.update(cpu => {
        cpu.acc = mask4Bit(immediateValue);
        // Set Flags
        cpu.flags.z = (cpu.acc === 0);
        cpu.flags.n = ((cpu.acc & 0x08) !== 0); // Check MSB for negative
        return cpu;
      });

    } else if (instruction.inst === 'STA_R') {
      const registerValue = extractRegisterRef(instruction) ?? 0;
      const accValue = this.cpu().acc;

      this.dataRam.update(ram => {
        ram[registerValue] = mask4Bit(accValue);
        return ram;
      });

    } else if (instruction.inst === 'ADD') {
      const immediateValue = extractImmediateValue(instruction) ?? 0;

      this.cpu.update(cpu => {
        cpu.acc = mask4Bit(cpu.acc + immediateValue);
        // Set Flags
        cpu.flags.z = (cpu.acc === 0);
        cpu.flags.n = ((cpu.acc & 0x08) !== 0); // Check MSB for negative
        return cpu;
      });

    } else if (instruction.inst === 'ADD_R') {
      const registerValue = extractRegisterRef(instruction) ?? 0;
      const immediateValue = this.dataRam()[registerValue];

      this.cpu.update(cpu => {
        cpu.acc = mask4Bit(cpu.acc + immediateValue);
        // Set Flags
        cpu.flags.z = (cpu.acc === 0);
        cpu.flags.n = ((cpu.acc & 0x08) !== 0); // Check MSB for negative
        return cpu;
      });

    } else if (instruction.inst === 'SUB') {
      const immediateValue = extractImmediateValue(instruction) ?? 0;

      this.cpu.update(cpu => {
        cpu.acc = mask4Bit(cpu.acc - immediateValue);
        // Set Flags
        cpu.flags.z = (cpu.acc === 0);
        cpu.flags.n = ((cpu.acc & 0x08) !== 0); // Check MSB for negative
        return cpu;
      });

    } else if (instruction.inst === 'SUB_R') {
      const registerValue = extractRegisterRef(instruction) ?? 0;
      const immediateValue = this.dataRam()[registerValue];

      this.cpu.update(cpu => {
        cpu.acc = mask4Bit(cpu.acc - immediateValue);
        // Set Flags
        cpu.flags.z = (cpu.acc === 0);
        cpu.flags.n = ((cpu.acc & 0x08) !== 0);
        return cpu;
      });

    } else if (instruction.inst === 'JMP') {
      const immediateValue = extractImmediateValue(instruction) ?? 0;

      this.cpu.update(cpu => {
        cpu.pc = mask4Bit(immediateValue);
        return cpu;
      });
      return true;

    } else if (instruction.inst === 'BRZ') {
      if (cpu.flags.z) {
        const immediateValue = extractImmediateValue(instruction) ?? 0;

        this.cpu.update(cpu => {
          cpu.pc = mask4Bit(cpu.pc + immediateValue);
          return cpu;
        });
        return true;
      }
    } else if (instruction.inst === 'BRC') {
      if (cpu.flags.c) {
        const immediateValue = extractImmediateValue(instruction) ?? 0;

        this.cpu.update(cpu => {
          cpu.pc = mask4Bit(cpu.pc + immediateValue);
          return cpu;
        });
        return true;
      }

    } else if (instruction.inst === 'BRN') {
      if (cpu.flags.n) {
        const immediateValue = extractImmediateValue(instruction) ?? 0;

        this.cpu.update(cpu => {
          cpu.pc = mask4Bit(cpu.pc + immediateValue);
          return cpu;
        });
        return true;
      }
    }

    return false;
  }

  public build(code: string) {
    const s = this.compiler.compile(code) as ParseResult;
    this.buildResult.set(s);

    for (let i = 0; i < s.ast.length; i++) {
      const instr = s.ast[i];
      this.instructionRam.update(ram => {
        ram[i] = this.instructionMap[instr.inst] ?? 0x00;

        return ram;
      });

      this.dataRam.update(ram => {
        let valueNode = instr.children.find(x => x.type === 'immediate' || x.type === 'register');
        if (valueNode) {
          if (valueNode.type === 'immediate') {
            ram[i] = mask4Bit((valueNode as Immediate).value);
          } else if (valueNode.type === 'register') {
            ram[i] = mask4Bit((valueNode as RegisterRef).value);
          }
        }
        return ram;
      });
    }

    this.logger.log(`Finished building program with ${s.ast.length} instructions.`);
  }

  public startDebug() {
    if (!this.buildResult()) return;

    this.isDebugMode.set(true);
    this.isRunning.set(true);
  }

  public run(){
    if (!this.buildResult()) return;

    const ast = this.buildResult()!.ast;

    while (true) {
      const cpu = this.cpu();

      const pc = cpu.pc;

      if (pc < 0 || pc >= ast.length) {
        this.logger.log('Programmende erreicht oder ungültige PC-Adresse.');
        break;
      }

      const instruction = ast[pc];

      const branched = this.execInstruction(instruction);

      if (!branched) {
        this.cpu.update(cpu => {
          cpu.pc = mask4Bit(cpu.pc + 1);
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

    console.log(instruction);

    const branched = this.execInstruction(instruction);

    if (!branched) {
      this.cpu.update(cpu => {
        cpu.pc = mask4Bit(cpu.pc + 1);
        return cpu;
      });
    }
  }

  reset() {
    this.cpu.set({
      acc: 0, pc: 0, ir: 0,
      flags: { z: false, n: false, c: false }
    });

    this.isDebugMode.set(false);
    this.isRunning.set(false);
  }

  private readonly instructionMap: {[key: string]: number} = {
    'NOP': 0x00,
    'LDA': 0x01,
    'LDA_R': 0x02,
    'STA_R': 0x03,
    'ADD': 0x04,
    'ADD_R': 0x05,
    'SUB': 0x06,
    'SUB_R': 0x07,
    'JMP': 0x08,
    'BRZ': 0x09,
    'BRC': 0x0A,
    'BRN': 0x0B,
  };

}

export function formatBin(val: number): string {
  return (val >>> 0).toString(2).padStart(4, '0');
}

export function formatHex(val: number): string {
  return '0x' + (val >>> 0).toString(16).toUpperCase();
}

export function mask4Bit(val: number): number {
  return val & 0x0F;
}

export interface CpuState {
  acc: number;  // Akkumulator
  pc: number; // Programmzähler
  ir: number;   // Instruction Register
  flags: {
    z: boolean; // Zero
    n: boolean; // Negative
    c: boolean; // Carry
  };
}
