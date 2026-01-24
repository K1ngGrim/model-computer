import {Injectable} from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class CompilerService {


  private tokenize(input: string): string[][] {
    return input
      .trim()
      .split("\n")
      .map(line => line.trim().split(/\s+/));
  }

  private parseInstructions(tokens: string[][]): ParseResult {

    const instructions: Instruction[] = [];

    const labelLookup: {[key: string]: number} = {};
    const log: { type: 'error'|'info', msg: string }[] = [];
    const unresolvedLabelRefs: Instruction[] = [];

    for (let i = 0; i < tokens.length; i++) {
      const line = tokens[i];

      let labelIndex = line.findIndex(x => x.startsWith(":"));

      let hasLabel = labelIndex >= 0;

      const label = hasLabel ? line[0].slice(1) : null;
      const cmd = line[hasLabel ? 1 : 0];
      const rawValue = line[hasLabel ? 2 : 1];

      let isRefInstruction = false;

      if ((!cmd || !rawValue) && !hasLabel) {
        throw new Error("Ungültiger Befehl");
      }else if ((!cmd || !rawValue) && hasLabel) {

      }

      let instruction: Instruction = {
        type: 'instruction',
      } as Instruction;
      instruction.children = [];
      let valueStr = rawValue;

      if (rawValue.startsWith('#') || cmd === "JMP") {
        instruction.inst = cmd as InstructionType;
        valueStr = cmd === "JMP"?rawValue : rawValue.slice(1);
      } else if (rawValue.startsWith("(") && rawValue.endsWith(")")) {
        instruction.inst = (cmd + "_R") as InstructionType;
        valueStr = rawValue.slice(1, -1);
        isRefInstruction = true;
      } else {
        instruction.inst = (cmd + "_R") as InstructionType;
        isRefInstruction = true;
      }

      instruction.mnemonic = cmd;

      if (cmd === "JMP") {

        const labelRef: LabelRef = {
          type: 'label_ref',
          name: valueStr
        };

        if (valueStr in labelLookup) {
          const immediate: Immediate = {
            type: 'immediate',
            value: labelLookup[valueStr]
          };
          instruction.children.push(immediate);
        } else {
          log.push({
            type: 'info',
            msg: `Unbekannter Bezeichner: ${valueStr} in Zeile ${i + 1}. Wird später aufgelöst.`
          });

          unresolvedLabelRefs.push(instruction);
        }


        instruction.children.push(labelRef);
      } else {
        const value = Number(valueStr);
        if (isNaN(value)) throw new Error(`Ungültige Zahl: ${rawValue}`);

        if (isRefInstruction) {
          const registerRef: RegisterRef = {
            register: value,
            type: 'register'
          };
          instruction.children.push(registerRef);
        }else {
          const immediate: Immediate = {
            type: 'immediate',
            value: value
          };
          instruction.children.push(immediate);
        }
      }

      if (hasLabel && label) {

        if (label in labelLookup) {
          log.push({
            type: 'error',
            msg: `Doppelter Bezeichner: ${label} in Zeile ${i + 1}`
          });
          return {
            ast: [],
            log: log
          }
        }

        labelLookup[label] = i;

        const labelNode: Label = {
          type: 'label',
          name: label
        };
        instruction.children.push(labelNode);
      }

      instructions.push(instruction);
    }

    for (const entry of unresolvedLabelRefs) {

      const labelRef = entry.children.find(child => (child as LabelRef).type === 'label_ref') as LabelRef;

      if (!labelRef) {
        log.push({
          type: 'error',
          msg: `Fehlender Bezeichner-Referenz in Anweisung.`
        });
        return {
          ast: [],
          log: log
        }
      }

      const valueStr = labelRef.name;


      if (valueStr in labelLookup) {
        const immediate: Immediate = {
          type: 'immediate',
          value: labelLookup[valueStr]
        };
        entry.children.push(immediate);
      } else {
        log.push({
          type: 'error',
          msg: `Unbekannter Bezeichner: ${valueStr} konnte nicht aufgelöst werden.`
        });
        return {
          ast: [],
          log: log
        }
      }
    }

    return {
      ast: instructions,
      log: log
    }
  }

  public compile(token: string): any {
    const lines = this.tokenize(token);
    return this.parseInstructions(lines);
  }

}

export function extractImmediateValue(node: ASTNode): number | null {
  if (node.type === 'immediate') {
    return (node as Immediate).value;
  }

  if (node.type === 'instruction' && (node as Instruction).children.length > 0) {
    for (const child of (node as Instruction).children) {
      const val = extractImmediateValue(child);
      if (val !== null) {
        return val;
      }
    }
  }
  return null;
}

export function extractRegisterRef(node: ASTNode): number | null {

  if (node.type === 'register') {
    return (node as RegisterRef).register;
  }

  if (node.type === 'instruction' && (node as Instruction).children.length > 0) {
    for (const child of (node as Instruction).children) {
      const val = extractRegisterRef(child);
      if (val !== null) {
        return val;
      }
    }
  }
  return null;
}

export interface ParseResult {
  ast: Instruction[];
  log: { type: 'error'|'info', msg: string }[];
}

export interface ASTNode {
  type: string;
  children?: ASTNode[];
}

export interface Instruction extends ASTNode {
  type: 'instruction';
  inst: InstructionType;
  mnemonic: string;
  children: ASTNode[];
}

export interface RegisterRef extends ASTNode {
  type: 'register'
  register: number;
}

export interface Label extends ASTNode {
  type: 'label'
  name: string;
}

export interface LabelRef {
  type: 'label_ref'
  name: string;
}

export interface Immediate extends ASTNode {
  type: 'immediate'
  value: number;
}

export type InstructionType = "NOP" | "LDA" | "LDA_R" | "STA_R" | "ADD" | "ADD_R" | "SUB" | "SUB_R" | "JMP" | "BRZ" | "BRC" | "BRN";
