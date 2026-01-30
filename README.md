# ModelComputer

Eine kleine Angular‑Webapp zur Modellierung und Simulation einer sehr einfachen 4‑Bit‑CPU.

## Kurzüberblick

- Zweck: Lernprojekt zum Schreiben eines einfachen Compilers und zum Verstehen einer einfachen Prozessorarchitektur.
- Das Prozessor‑Modell orientiert sich an: "Grundlagen der technischen Informatik" von Dirk W. Hoffmann (als pädagogische Vorlage für Register/ACC/PC‑Semantik und einfache Instruktionsformen).
- Die App enthält einen Assembler‑Compiler (`compiler-service.ts`) und eine CPU‑/Prozessor‑Simulation (`processor-service.ts`).
- Ziel ist Lernzweck: Verständnis für Parsing, Labelauflösung, einfache Instruktionssemantik und CPU‑State‑Updates.

## Projektstruktur (wichtige Dateien)

- `src/app/services/compiler-service.ts` — Parser/Compiler: Tokenisierung, Parsen in AST, Labelauflösung, Hilfsfunktionen zum Auslesen von Immediate/Registerwerten.
- `src/app/services/processor-service.ts` — CPU‑Simulation: Build (Laden in RAM), Ausführungslogik (`execInstruction`), Lauf/Step/Debug‑Funktionen.
- `src/app/components/code-editor` — UI‑Komponente zur Eingabe des Codes und Steuerung der Simulation.

Hinweis: In dieser README werden die relevanten Abläufe in `compiler-service.ts` und `processor-service.ts` zusammengefasst, damit du schnell verstehst, wie Compiler und Prozessor zusammenarbeiten.

## Compiler — Funktionsweise (Datei: `src/app/services/compiler-service.ts`)

**Kurzvertrag**
- **Input:** roher Assemblertext (string).
- **Output:** `ParseResult` mit `ast: Instruction[]`. Bei schwerwiegenden Fehlern wird ein leeres AST zurückgegeben und relevante Meldungen über `LoggingService` geloggt.

**Wichtige Schritte im Compiler**

1. **Tokenisierung (`tokenize`)**
    - Entfernt führende/folgende Leerzeichen, splittet den Input in Zeilen, entfernt leere Zeilen.
    - Jede Zeile wird in Token (mit Whitespace) zerlegt.
    - Ergebnis: `string[][]` (Array von Tokenarrays pro Zeile).

2. **Parsen (`parseInstructions`)**
    - Iteriert über die Tokenzeilen und erzeugt für jede Zeile ein `Instruction`‑Objekt.
    - Erkannt werden:
      - Optionales Label zu Anfang einer Zeile: Token das mit `:` beginnt, z. B. `:LOOP`.
      - Mnemonic (Befehl) wie `LDA`, `ADD`, `JMP`, `BRZ`, `STA`, `NOP`.
      - Operand:
        - Unmittelbare Zahl: `5`
        - Registerreferenz in Klammern: `(2)` → `register` Node
        - Labelreferenz: `LABEL` oder mit Präfix `#LABEL` für Sprungziele

    - Das Parsing legt fest, ob eine Instruktion einen Suffix `_R` bekommt (Registervariante) oder eine unmittelbare Variante.
    - `JMP` behandelt Labelreferenzen speziell: es erzeugt ein `label_ref` Child, ggf. wird sofort ein `immediate` Child mit Zieladresse erzeugt, ansonsten wird die Instruktion in eine Liste `unresolvedLabelRefs` aufgenommen.

3. **Labelauflösung**
    - Nach dem ersten Pass werden alle Einträge in `unresolvedLabelRefs` durchlaufen.
    - Für jede `label_ref` wird anhand von `labelLookup` die Zieladresse ermittelt und als `immediate` Child angehängt.
    - Falls ein Label nicht gefunden wird, wird ein Fehler geloggt und ein leeres AST zurückgegeben.

**AST‑Formate (wesentliche Interfaces)**
- Instruction: `{ type: 'instruction', inst: InstructionType, mnemonic: string, children: ASTNode[] }`
- Immediate: `{ type: 'immediate', value: number }`
- RegisterRef: `{ type: 'register', value: number }`
- Label: `{ type: 'label', name: string }`
- LabelRef: `{ type: 'label_ref', name: string }`

**Hilfsfunktionen im Compiler**
- `extractImmediateValue(node: ASTNode)` — rekursiv das erste `immediate` Kind finden und dessen Zahl zurückgeben (oder `null`).
- `extractRegisterRef(node: ASTNode)` — rekursiv das erste `register` Kind finden und dessen Registerindex zurückgeben (oder `null`).

**Fehlerbehandlung**
- Ungültige Zahlen (z. B. `NaN`) werden als Fehler betrachtet.
- Doppelte Labels werden als Fehler geloggt.
- Unauflösbare Labelreferenzen führen zur Rückgabe eines leeren ASTs.

**Beispiel (Assembler → Tokens → AST)**

Assembler:
```
:LOOP LDA 1
ADD 2
BRZ #END
JMP #LOOP
:END NOP
```
Tokenisierung → `[[':LOOP','LDA','1'], ['ADD','2'], ['BRZ','#END'], ['JMP','#LOOP'], [':END','NOP']]`
Parsed AST → Jede Zeile wird zu einer `Instruction` mit passenden `children` (z. B. `immediate`, `label_ref`, `label`).

## Prozessor — Funktionsweise (Datei: `src/app/services/processor-service.ts`)

**Kurzvertrag**
- **Input:** `ParseResult` (AST) via `build(code: string)`.
- **Output:** Signals mit CPU‑Zustand, Instruction/Data RAM‑Inhalt, Flags und Status (isRunning, isDebugMode).

**Interne Zustände**
- CPU: `{ acc: number, pc: number, ir: number, flags: { z, n, c } }`
- `instructionRam`: Array mit 16 Einträgen für Opcodes (4‑Bit möglich, im Code werden hex Werte wie 0x01 verwendet).
- `dataRam`: Array mit 16 Einträgen für sofortige Operanden oder Registerindizes.
- `buildResult`: enthält das letzte `ParseResult`.

**Wichtige Methoden**

1. **`build(code: string)`**
    - Ruft den Compiler auf: `this.compiler.compile(code)` und setzt `buildResult`.
    - Iteriert über `s.ast` und schreibt für jede Instruktion:
      - `instructionRam[i]` ← Opcode aus `instructionMap` (z. B. `'LDA' => 0x01`).
      - Sucht in `instr.children` nach `immediate` oder `register` und schreibt `dataRam[i]` den maskierten 4‑Bit‑Wert.
    - Loggt Fertigmeldung.

2. **`execInstruction(instruction: Instruction)`**
    - Führt eine Instruktion aus und aktualisiert `cpu` bzw. `dataRam`.
    - Rückgabewert: `true` wenn ein Sprung/Branch das `pc` bereits gesetzt hat (Caller soll PC nicht zusätzlich inkrementieren), sonst `false`.

**Implementierte Instruktionen (Kurzbeschreibung)**
- NOP: keine Änderung.
- LDA: Lade immediate in ACC; setze Flags Z (zero) und N (negativ = MSB).
- LDA_R: Lade aus `dataRam[register]` in ACC.
- STA_R: Schreibe ACC in `dataRam[register]`.
- ADD: Addiere immediate zum ACC, maskiere auf 4 Bit, setze Flags (Z,N). (Carry `c` wird aktuell nicht gesetzt.)
- ADD_R: Registervariante von ADD — addiert den Wert aus `dataRam[register]` zum ACC, maskiert auf 4 Bit und setzt Flags (Z,N).
- SUB: Subtrahiere immediate von ACC, maskiere auf 4 Bit, setze Flags (Z,N).
- SUB_R: Registervariante von SUB — subtrahiert den Wert aus `dataRam[register]` vom ACC, maskiert auf 4 Bit und setzt Flags (Z,N).
- JMP: Setze PC direkt auf immediate (Zieladresse). Gibt `true` zurück.
- BRZ/BRC/BRN: Bedingte Sprünge: falls jeweiliges Flag gesetzt ist, PC = PC + immediate (Offset), `true` zurück.

**Wichtige Hilfsfunktionen**
- `mask4Bit(val)` — `val & 0x0F` (stellt sicher, dass Werte 0–15 bleiben).
- `formatBin` / `formatHex` — Hilfen für die UI.

## Ausführen

- `run()` führt das ganze Programm in einer Schleife aus bis der `pc` außerhalb des AST liegt oder ein Fehler auftritt.
- `step()` führt genau eine Instruktion aus.
- `startDebug()` setzt `isDebugMode` und `isRunning`.

**Speicherlayout beim Build**
- Für jede AST‑Zeile i wird `instructionRam[i]` mit dem Opcode gefüllt. Falls die Instruktion einen Immediate‑Wert oder Registerreferenz besitzt, wird `dataRam[i]` ebenfalls mit dem entsprechenden (maskierten) Wert beschrieben.

**Beispielprogramm: Countdown (Kommentarformat für Lesbarkeit)**
```
; Initialisiere MEM[0] = 3
LDA 3
STA (0)

; Schleife: Lade MEM[0], dekrementiere, speichere, prüfe 0
:LOOP LDA_R (0)
SUB 1
STA (0)
BRZ #END
JMP #LOOP

:END NOP
```
Erwartung: `MEM[0]` wird 3 → 0 heruntergezählt; bei Null springt BRZ zu `END`.

## Installation & Entwicklung (Powershell)

**Voraussetzungen**
- Node.js (LTS empfohlen)
- npm
- Optional: Angular CLI (`npm i -g @angular/cli`) für Komfortbefehle

**Schnellstart (im Projektverzeichnis):**

```powershell
cd "C:\Users\flolu\Documents\Workspace\Privat\ModelComputer"
npm install
npm run start
# Alternativ mit Angular CLI:
# npx ng serve --open
```

Die App ist dann unter http://localhost:4200/ erreichbar.

**Debugging‑Tipps**
- Wenn Labels nicht aufgelöst werden, prüfe das Log (über `LoggingService`) auf Meldungen wie "Unknown identifier" oder "Unknown label reference".
- Bei ungültigen Zahlenprüfungen (z. B. Nicht‑Zahlen als Immediate) wird eine Fehlermeldung ausgegeben.
- Falls du unerwartetes Verhalten bei arithmetischen Operationen siehst, bedenke, dass das Carry‑Flag (`c`) momentan noch nicht automatisch gesetzt wird; Überläufe werden dadurch nicht als Carry markiert. Das beeinflusst nur bedingte Sprünge auf `c`.

**Bekannte Einschränkungen & ToDos**
- Carry‑Flag (`c`) wird bei Arithmetik derzeit nicht automatisch gesetzt/aktualisiert (kann erweitert werden, um Überläufe korrekt zu handhaben).
- RAM‑Größe ist fest auf 16 Einträge begrenzt.
- Parser und Fehlerbehandlung sind funktional, könnten robuster gestaltet werden (z. B. bessere Fehlermeldungen mit Zeilennummern, Comments, Macros).
- Hinweis: `ADD_R` und `SUB_R` sind jetzt implementiert (Registervarianten von ADD/SUB). Falls du noch unerwartetes Verhalten siehst, können wir gemeinsam Unit‑Tests ergänzen.

## Quelle / Inspiration
- Das verwendete Prozessor‑Modell ist pädagogisch an Dirk W. Hoffmanns "Grundlagen der technischen Informatik" angelehnt; das Buch ist eine gute Referenz, wenn du die konzeptionellen Grundlagen vertiefen möchtest.
