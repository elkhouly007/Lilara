---
pattern_id: dd destructive disk write
pattern_source: claude/hooks/dangerous-patterns.json
severity: critical
---

# dd destructive disk write — Rationalization Defense

## Rationalization Table

| Excuse | Reality |
|--------|---------|
| "I'm writing a disk image for backup / deployment purposes." | Disk image writes are typically handled by provisioning pipelines or dedicated tools (Clonezilla, `dd_rescue` with verification). An agent writing raw device output at runtime is almost always an error or an injected action. |
| "The `of=` target is a loop device — not a real disk." | Loop devices can back real files on real disks. Corrupting a loop device backing file corrupts the files that use it. |
| "I double-checked the `of=` path." | The pattern fires when `of=` targets `/dev/`, which is the namespace for real devices. There is no legitimate agent-time use-case for writing to `/dev/sda`, `/dev/nvme0n1`, or similar. |
| "This is how you create bootable USB drives." | Creating bootable USB drives is a human-interactive task, not an agent task. The human should run this command directly, not delegate it. |

## Red Flags (STOP thoughts)

- "The `of=` target is definitely the right device."
- "I'm copying an image file, not destroying data."
- "This is standard disk imaging."
- "The loop device is safe."

## Why this pattern is here

`dd if=... of=/dev/...` writes raw bytes to a device. Unlike `mkfs`, `dd` can
destroy existing data even on a mounted, in-use device — it bypasses the
filesystem layer entirely. A single wrong device path writes to the wrong disk.

The pattern specifically matches `of=/dev/` to catch disk device targets.
Legitimate uses of `dd` (copying files to files, generating random data) are
not matched.

## Safer alternative

```bash
# For disk imaging: use a dedicated tool with verification
# (run by the operator, not the agent)
dd if=/dev/sda of=/backup/disk.img bs=4M status=progress
# Then verify: sha256sum /backup/disk.img

# For writing a disk image: use Clonezilla or Ventoy for USB creation
# For deployment: use provisioning pipelines (Packer, cloud-init)

# If the agent needs to write data to storage: write to a file, not /dev/
output_file="/backup/data-$(date +%Y%m%d).bin"
dd if=/dev/urandom of="$output_file" bs=1M count=10   # to a FILE, not a device
```
