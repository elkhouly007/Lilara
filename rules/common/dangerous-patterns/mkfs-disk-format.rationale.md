---
last_reviewed: 2026-05-24
version_target: 0.1.0
pattern_id: mkfs (disk format)
pattern_source: claude/hooks/dangerous-patterns.json
severity: critical
---

# mkfs (disk format) — Rationalization Defense

## Rationalization Table

| Excuse | Reality |
|--------|---------|
| "I need to prepare a new disk for use." | Preparing a disk for use requires knowing with certainty which device file corresponds to the new disk. Agents cannot reliably determine this — `lsblk` output depends on enumeration order, which varies between boots and hotplug events. |
| "The device is `/dev/sdb` — I verified it with `lsblk`." | Device naming is not stable across reboots or hotplug events. What was `/dev/sdb` in one `lsblk` run may be `/dev/sda` after a reboot, especially in cloud environments with multiple block devices. |
| "This is a fresh cloud instance — there's no data to lose." | Cloud instances often have metadata drives, ephemeral NVMe stores with credentials, or attached persistent volumes from previous instances. "Fresh" does not mean "empty." |
| "The disk image will be discarded anyway." | If the disk image is to be discarded, there is no need to format it now. Format at provisioning time via the infrastructure tool (Packer, Terraform, cloud-init), not via an agent at runtime. |

## Red Flags (STOP thoughts)

- "I can tell which disk is which from the output."
- "It's a fresh cloud instance."
- "The disk will be wiped later anyway."
- "I need to set up the filesystem before the next step."

## Why this pattern is here

`mkfs` destroys the existing filesystem on a device partition. Recovery is
impossible without a verified backup of the partition table and filesystem
metadata. A single wrong device reference formats the operating system drive
or a data volume.

This pattern is almost never the right tool for an agent to use autonomously.
Disk provisioning belongs in infrastructure-as-code (Packer, Terraform, cloud-init)
where changes are peer-reviewed, version-controlled, and idempotent.

## Safer alternative

```bash
# Use infrastructure tools for disk provisioning:
# Packer: runs mkfs in a controlled image-build pipeline
packer build server.pkr.hcl

# cloud-init: declare filesystem at instance launch time
# (in the cloud-init YAML, not in a runtime script)

# If truly needed: verify device identity with multiple signals
lsblk --json -o NAME,SIZE,TYPE,MOUNTPOINT,SERIAL
# Cross-check: size, serial number, mount status — NOT just name
# And require explicit operator approval before proceeding
```
