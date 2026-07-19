# Operation State Machine

Every file-backed modification in Solith is tracked via a strict, database-persisted operation state machine to guarantee atomicity and safety.

## Authoritative Transition Graph

```mermaid
stateDiagram-v2
    [*] --> DRAFT : createOperation()
    DRAFT --> PROPOSED : transitionOperation()
    DRAFT --> CANCELLED : User Cancels
    
    PROPOSED --> DRY_RUN_PASSED : Dry Run Succeeds
    PROPOSED --> FAILED : Dry Run Fails
    PROPOSED --> CANCELLED : User Cancels
    
    DRY_RUN_PASSED --> AWAITING_APPROVAL : Awaiting User Confirm
    DRY_RUN_PASSED --> FAILED : Validation Fails
    DRY_RUN_PASSED --> CANCELLED : User Cancels
    
    AWAITING_APPROVAL --> BACKUP_CREATED : Backup Created & Verified
    AWAITING_APPROVAL --> CANCELLED : User Cancels
    
    BACKUP_CREATED --> APPLYING : Write Initiated
    BACKUP_CREATED --> FAILED : Write Setup Fails
    
    APPLYING --> VALIDATING : Swap Rename Succeeds
    APPLYING --> FAILED : Atomic Write Fails
    
    VALIDATING --> COMPLETED : Post-write Hash Verified
    VALIDATING --> FAILED : Hash Mismatch / Verify Fails
    
    COMPLETED --> RESTORING : Rollback Initiated
    FAILED --> RESTORING : Auto-rollback on Failure
    
    RESTORING --> RESTORED : Restore Swap Succeeds
    RESTORING --> RESTORE_FAILED : Restore Swap Fails
```

## Operation States & Persistence
* **DRAFT**: Initial operational record created.
* **PROPOSED**: Operations options resolved and prepared for dry run.
* **DRY_RUN_PASSED**: The parser successfully simulated the edit on target file structure.
* **AWAITING_APPROVAL**: Prompting user for approval before backup/apply.
* **BACKUP_CREATED**: Original file backup taken, verified with double-hash check, and stored in `backups` table.
* **APPLYING**: Temporary sibling file written and validated, ready to replace target.
* **VALIDATING**: Target file replaced; verifying final target size and hash.
* **COMPLETED**: Modification successfully committed and verified.
* **FAILED**: Operation aborted during dry run or write phase.
* **RESTORING**: Rollback sequence initiated.
* **RESTORED**: Original target successfully restored from backup.
* **RESTORE_FAILED**: Target rollback failed to replace or verify.
* **CANCELLED**: Operation aborted by the user or system before backup creation.
