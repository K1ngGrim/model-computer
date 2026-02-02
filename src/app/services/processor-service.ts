import {inject, Injectable, signal} from '@angular/core';
import {CompilerService, Immediate, ParseResult, RegisterRef} from './compiler-service';
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

  get nextInstruction() {
    const cpu = this.cpu();
    const pc = cpu.pc;

    const instructionRam = this.instructionRam();
    const dataRam = this.dataRam();

    const instructionCode = instructionRam[pc] ?? 0;
    const dataCode = dataRam[pc] ?? 0;

    return { instructionCode, dataCode };
  }

  public execInstruction(instruction: number, data: number): boolean {
    const cpu = this.cpu();

    const parsedInstruction = this.getKeyByValue(instruction);

    if (!parsedInstruction) {
      this.logger.log(`Unbekannter Befehlscode: ${formatHex(instruction)}`, 'error');
      return false;
    }

    if (parsedInstruction === 'NOP') {
      return false;
    } else if (parsedInstruction === 'LDA') {
      this.lda(data);

    } else if (parsedInstruction === 'LDA_R') {
      const immediateValue = this.dataRam()[data];
      this.lda(immediateValue);

    } else if (parsedInstruction === 'STA_R') {
      this.sta(data)

    } else if (parsedInstruction === 'ADD') {
      this.add(data);

    } else if (parsedInstruction === 'ADD_R') {
      const immediateValue = this.dataRam()[data];
      this.add(immediateValue);

    } else if (parsedInstruction === 'SUB') {
      this.add(-data);

    } else if (parsedInstruction === 'SUB_R') {
      const immediateValue = this.dataRam()[data];
      this.add(-immediateValue);

    } else if (parsedInstruction === 'JMP') {
      this.jump(data);
      return true;

    } else if (parsedInstruction === 'BRZ') {
      if (cpu.flags.z) {
        this.branch(data);
        return true;
      }
    } else if (parsedInstruction === 'BRC') {
      if (cpu.flags.c) {
        this.branch(data);
        return true;
      }

    } else if (parsedInstruction === 'BRN') {
      if (cpu.flags.n) {
        this.branch(data);
        return true;
      }
    }

    return false;
  }

  public build(code: string) {
    const s = this.compiler.compile(code) as ParseResult;
    this.buildResult.set(s);

    this.instructionRam.set(new Array(16).fill(0))
    this.dataRam.set(new Array(16).fill(0));

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

      const instruction = this.nextInstruction;

      const pcOld = cpu.pc;

      const branched = this.execInstruction(instruction.instructionCode, instruction.dataCode);

      if (!branched) {
        this.cpu.update(cpu => {
          cpu.pc = mask4Bit(cpu.pc + 1);
          return cpu;
        });
      }else {
        if (instruction.dataCode === pcOld) {
          this.logger.log('The program ran into an infinite loop. The program stopped.', 'warn');
          this.isDebugMode.set(false);
          this.isRunning.set(false);
          break;
        }
      }
    }
  }

  public step(){
    if (!this.buildResult()) return;

    const instruction = this.nextInstruction;
    const branched = this.execInstruction(instruction.instructionCode, instruction.dataCode);

    if (!branched) {
      this.cpu.update(cpu => {
        cpu.pc = mask4Bit(cpu.pc + 1);
        return cpu;
      });
    }
  }

  public reset() {
    this.cpu.set({
      acc: 0, pc: 0, ir: 0,
      flags: { z: false, n: false, c: false }
    });

    this.isDebugMode.set(false);
    this.isRunning.set(false);
  }

  private getKeyByValue(value: number): string | undefined {
    return Object.keys(this.instructionMap)
      .find(key => this.instructionMap[key] === value);
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

  private add(num: number) {
    this.cpu.update(cpu => {
      cpu.acc = mask4Bit(cpu.acc + num);
      cpu.flags.z = (cpu.acc === 0);
      cpu.flags.c = (cpu.acc + num) > 0b1111;
      cpu.flags.n = ((cpu.acc & 0x08) !== 0);
      return cpu;
    });
  }

  private jump(address: number) {
    this.cpu.update(cpu => {
      cpu.pc = mask4Bit(address);
      return cpu;
    });
  }

  private branch(step: number) {
    this.cpu.update(cpu => {
      cpu.pc = mask4Bit(cpu.pc + step);
      return cpu;
    });
  }

  private lda(value: number) {
    this.cpu.update(cpu => {
      cpu.acc = mask4Bit(value);
      cpu.flags.z = (cpu.acc === 0);
      cpu.flags.c = (cpu.acc) > 0b1111;
      cpu.flags.n = ((cpu.acc & 0x08) !== 0);
      return cpu;
    });
  }

  private sta(address: number) {
    const accValue = this.cpu().acc;

    this.dataRam.update(ram => {
      ram[address] = mask4Bit(accValue);
      return ram;
    });
  }
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
