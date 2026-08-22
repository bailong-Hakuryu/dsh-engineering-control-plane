---
status: accepted
---

# Stable roles carry Assurance Requirements

Planner, Developer, Tester, and Reviewer remain the stable authority roles, while individual Role Runs are assigned one or more Assurance Requirements. An Attempt may execute several independent Reviewer Role Runs for Spec, Standards, Security, or other obligations, but Developer cannot satisfy review requirements over its own implementation; this avoids both proliferating fixed role names and losing safety boundaries in a fully dynamic role system.

Design analysis is a one-shot Planner Role Assignment for each Frontier Round, reconstructed from durable Mission facts rather than a continuable child session. Action review is a non-Gate-bearing Reviewer Role Assignment. Assignment purpose may vary, but role authority never does.

Review-bearing Assurance Requirements declare an Independence Group and minimum assessor count. Specification, repository standards, and security use separate groups by default; Kernel assignment validation prevents one Role Run or the Developer execution identity from satisfying incompatible groups, while policy may require multiple distinct assessors for a high-risk group.
