import {Component, computed, ElementRef, inject, signal, viewChild} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {NgClass, UpperCasePipe} from '@angular/common';
import {MatIcon, MatIconRegistry} from '@angular/material/icon';
import {DomSanitizer} from '@angular/platform-browser';
import {CodeEditor} from './components/code-editor/code-editor';
import {formatBin, ProcessorService} from './services/processor-service';
import {LoggingService} from './services/logging-service';

@Component({
  selector: 'app-root',
  imports: [FormsModule, NgClass, MatIcon, CodeEditor, UpperCasePipe],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {

  public readonly editor = viewChild<CodeEditor>('codeEditor')

  public readonly isEditorReadOnly = signal(false);

  private matIconRegistry = inject(MatIconRegistry);
  private domSanitizer = inject(DomSanitizer);
  protected processorService = inject(ProcessorService);
  protected logger = inject(LoggingService);

  public readonly isRunning = this.processorService.isRunning;
  public readonly isDebugMode = this.processorService.isDebugMode;

  public logEntries = computed(() => {
    return this.logger.logs();
  });

  public readonly hasChanges = signal(false);

  public readonly editorContent = signal<string>(`LDA #1
:loop ADD #2
SUB #1
STA 15
BRN #2
JMP loop`);

  constructor() {
    this.matIconRegistry.addSvgIconSet(
      this.domSanitizer.bypassSecurityTrustResourceUrl('./assets/mdi.svg')
    );
  }

  protected build() {
    this.logger.clear();
    this.editor()?.reformatCode();
    this.processorService.build(this.editorContent());
    this.hasChanges.set(false);
  }

  protected run() {
    this.isEditorReadOnly.set(true);
    this.processorService.run();
    this.isEditorReadOnly.set(false);
  }

  protected debug() {
    this.isEditorReadOnly.set(true);
    this.processorService.startDebug();
    this.editor()?.setDebugLine(this.processorService.programmCounter()+1);
  }

  protected stepForward() {
    this.processorService.step();
    this.editor()?.setDebugLine(this.processorService.programmCounter()+1);
  }

  protected stop() {
    this.isEditorReadOnly.set(false);
    this.processorService.reset();
  }

  protected contentChange() {
    this.hasChanges.set(true);
  }


  protected readonly formatBin = formatBin;
}
