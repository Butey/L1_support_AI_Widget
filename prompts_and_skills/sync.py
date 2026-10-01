#!/usr/bin/env python3
"""
Sync utility for prompts_and_skills <-> storage/settings.json
Usage:
  python3 prompts_and_skills/sync.py --check   # Verify sync status
  python3 prompts_and_skills/sync.py --export  # Export from settings.json to markdown files
  python3 prompts_and_skills/sync.py --import  # Import markdown files into settings.json
"""

import os
import sys
import json
import re

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SETTINGS_PATH = os.path.join(BASE_DIR, "storage", "settings.json")
PROMPTS_DIR = os.path.join(BASE_DIR, "prompts_and_skills")
SYSTEM_PROMPT_PATH = os.path.join(PROMPTS_DIR, "SYSTEM_PROMPT.md")
ACTIVE_DIR = os.path.join(PROMPTS_DIR, "skills", "active")
DISABLED_DIR = os.path.join(PROMPTS_DIR, "skills", "disabled")
OVERVIEW_PATH = os.path.join(PROMPTS_DIR, "SKILLS_OVERVIEW.md")


def read_settings():
    if not os.path.exists(SETTINGS_PATH):
        raise FileNotFoundError(f"Settings file not found: {SETTINGS_PATH}")
    with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def write_settings(data):
    with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def get_skill_files():
    files = {}
    for folder, is_active in [(ACTIVE_DIR, True), (DISABLED_DIR, False)]:
        if not os.path.exists(folder):
            continue
        for fname in sorted(os.listdir(folder)):
            if fname.endswith(".md"):
                fpath = os.path.join(folder, fname)
                files[fname] = {
                    "path": fpath,
                    "folder": folder,
                    "is_active": is_active,
                    "filename": fname
                }
    return files


def parse_skill_markdown(content):
    lines = content.splitlines()
    id_m = re.search(r"\- \*\*ID:\*\* `([^`]+)`", content)
    status_m = re.search(r"\- \*\*Статус:\*\* `([^`]+)`", content)
    source_m = re.search(r"\- \*\*Источник:\*\* `([^`]+)`", content)
    date_m = re.search(r"\- \*\*Дата импорта:\*\* `([^`]+)`", content)

    # Content starts after the first horizontal rule separator `---` (around line 9-10)
    separator_idx = -1
    dashes_count = 0
    for idx, line in enumerate(lines):
        if line.strip() == "---":
            dashes_count += 1
            if dashes_count == 1:
                separator_idx = idx
                break

    if separator_idx != -1 and separator_idx + 1 < len(lines):
        body = "\n".join(lines[separator_idx + 1:]).lstrip("\n")
    else:
        body = content

    return {
        "id": id_m.group(1) if id_m else None,
        "status": status_m.group(1) if status_m else None,
        "source": source_m.group(1) if source_m else None,
        "import_date": date_m.group(1) if date_m else None,
        "content": body
    }


def check_sync():
    settings = read_settings()
    sys_prompt_settings = settings.get("system_prompt", "")
    
    with open(SYSTEM_PROMPT_PATH, "r", encoding="utf-8") as f:
        sys_prompt_file = f.read()

    print("==================================================")
    print(" OmniAI Prompts & Skills Synchronization Status")
    print("==================================================")

    # 1. Check system prompt
    prompt_match = (sys_prompt_settings == sys_prompt_file)
    print(f"\n[1] System Prompt:")
    print(f"    - settings.json size: {len(sys_prompt_settings)} chars")
    print(f"    - SYSTEM_PROMPT.md size: {len(sys_prompt_file)} chars")
    print(f"    - Exact match: {'OK (MATCH)' if prompt_match else 'DIFF DETECTED'}")

    # 2. Check skills
    skills_raw = settings.get("skills", "[]")
    skills_list = json.loads(skills_raw) if isinstance(skills_raw, str) else skills_raw
    skill_files = get_skill_files()

    print(f"\n[2] Skills Status (Total in settings: {len(skills_list)}, Total files: {len(skill_files)}):")
    
    all_ok = prompt_match
    for sk in skills_list:
        sid = sk.get("id")
        sname = sk.get("name")
        senabled = sk.get("enabled", False)
        scontent = sk.get("content", "")

        matched_file = None
        for fname, info in skill_files.items():
            with open(info["path"], "r", encoding="utf-8") as f:
                c = f.read()
            if f"- **ID:** `{sid}`" in c or (sid and sid in fname):
                matched_file = (fname, info, c)
                break

        if not matched_file:
            print(f"    [!] MISSING FILE for skill ID {sid} ({sname})")
            all_ok = False
            continue

        fname, info, file_text = matched_file
        parsed = parse_skill_markdown(file_text)

        folder_correct = (info["is_active"] == senabled)
        content_matches = (parsed["content"].strip() == scontent.strip())
        
        status_flag = "OK" if (folder_correct and content_matches) else "DIFF"
        if status_flag != "OK":
            all_ok = False

        print(f"    - [{status_flag}] {sid:<16} | {sname:<42} | Active: {str(senabled):<5} | File: {fname}")
        if not folder_correct:
            expected = "active" if senabled else "disabled"
            actual = "active" if info["is_active"] else "disabled"
            print(f"        -> Folder mismatch: in '{actual}', expected '{expected}'")
        if not content_matches:
            print(f"        -> Content length mismatch: settings={len(scontent)} vs file={len(parsed['content'])}")

    print("\n--------------------------------------------------")
    if all_ok:
        print("RESULT: All prompts and skills are 100% in sync!")
    else:
        print("RESULT: Discrepancies detected. Run with --export or --import to resolve.")
    print("==================================================")
    return all_ok


def export_to_files():
    settings = read_settings()
    sys_prompt = settings.get("system_prompt", "")

    # Ensure character count in header is accurate (28489 chars)
    real_prompt_len = len(sys_prompt)
    if "Размер:**" in sys_prompt:
        sys_prompt = re.sub(r"Размер:\*\* [0-9]+ символов", f"Размер:** {real_prompt_len} символов", sys_prompt)
        settings["system_prompt"] = sys_prompt
        write_settings(settings)

    with open(SYSTEM_PROMPT_PATH, "w", encoding="utf-8") as f:
        f.write(sys_prompt)
    print(f"[Export] Saved SYSTEM_PROMPT.md ({real_prompt_len} chars)")

    skills_raw = settings.get("skills", "[]")
    skills_list = json.loads(skills_raw) if isinstance(skills_raw, str) else skills_raw
    skill_files = get_skill_files()

    file_counter = 0
    for sk in skills_list:
        sid = sk.get("id")
        sname = sk.get("name")
        senabled = sk.get("enabled", False)
        scontent = sk.get("content", "")

        target_folder = ACTIVE_DIR if senabled else DISABLED_DIR
        target_status = "АКТИВЕН (включен в LLM контекст)" if senabled else "ОТКЛЮЧЕН (выключен в настройках)"

        # Find existing file to preserve filename & header details if possible
        existing_fname = None
        source_url = None
        import_date = None

        for fname, info in skill_files.items():
            with open(info["path"], "r", encoding="utf-8") as f:
                c = f.read()
            if f"- **ID:** `{sid}`" in c or sid in fname:
                existing_fname = fname
                parsed = parse_skill_markdown(c)
                source_url = parsed["source"]
                import_date = parsed["import_date"]
                # If folder changed, remove old file
                if info["folder"] != target_folder:
                    os.remove(info["path"])
                break

        if not existing_fname:
            slug = re.sub(r"[^a-zA-Z0-9а-яА-Я]+", "-", sname.lower()).strip("-")
            file_counter += 1
            existing_fname = f"{file_counter:02d}-{slug}.md"

        if not source_url:
            source_url = f"https://raw.githubusercontent.com/efDaCartoonz/smartplatform-assistant/main/skills/{sid}/SKILL.md"
        if not import_date:
            import_date = "2026-09-17T10:33:50.000Z"

        header = f"""# Навык: {sname}

- **ID:** `{sid}`
- **Статус:** `{target_status}`
- **Источник:** `{source_url}`
- **Дата импорта:** `{import_date}`
- **Размер контента:** {len(scontent)} символов

---

"""
        target_path = os.path.join(target_folder, existing_fname)
        with open(target_path, "w", encoding="utf-8") as f:
            f.write(header + scontent + "\n")
        print(f"[Export] Saved skill '{sname}' -> {os.path.relpath(target_path, BASE_DIR)} ({len(scontent)} chars)")

    print("[Export] Complete! All files updated.")


def import_from_files():
    settings = read_settings()
    
    # 1. Import system prompt
    with open(SYSTEM_PROMPT_PATH, "r", encoding="utf-8") as f:
        sys_prompt = f.read()
    
    settings["system_prompt"] = sys_prompt
    print(f"[Import] Loaded SYSTEM_PROMPT.md ({len(sys_prompt)} chars)")

    # 2. Import skills
    skills_raw = settings.get("skills", "[]")
    skills_list = json.loads(skills_raw) if isinstance(skills_raw, str) else skills_raw
    skill_files = get_skill_files()

    skills_by_id = {sk.get("id"): sk for sk in skills_list}

    for fname, info in skill_files.items():
        with open(info["path"], "r", encoding="utf-8") as f:
            raw_content = f.read()
        parsed = parse_skill_markdown(raw_content)
        sid = parsed["id"]
        if not sid:
            continue
        
        body = parsed["content"].rstrip("\n")
        is_active = info["is_active"]

        # Update character count in header if needed
        real_len = len(body)
        new_raw = re.sub(r"Размер контента:\*\* [0-9]+ символов", f"Размер контента:** {real_len} символов", raw_content)
        if new_raw != raw_content:
            with open(info["path"], "w", encoding="utf-8") as f:
                f.write(new_raw)

        if sid in skills_by_id:
            skills_by_id[sid]["content"] = body
            skills_by_id[sid]["enabled"] = is_active
            print(f"[Import] Updated skill '{skills_by_id[sid].get('name')}' ({sid}): {real_len} chars, active={is_active}")
        else:
            # New skill
            title_m = re.search(r"^# Навык: (.+)$", raw_content, re.MULTILINE)
            name = title_m.group(1).strip() if title_m else sid
            new_skill = {
                "id": sid,
                "name": name,
                "enabled": is_active,
                "content": body
            }
            skills_list.append(new_skill)
            skills_by_id[sid] = new_skill
            print(f"[Import] Added new skill '{name}' ({sid}): {real_len} chars, active={is_active}")

    settings["skills"] = json.dumps(skills_list, ensure_ascii=False)
    write_settings(settings)
    print(f"[Import] Saved updated settings to {os.path.relpath(SETTINGS_PATH, BASE_DIR)}")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--export":
        export_to_files()
        check_sync()
    elif len(sys.argv) > 1 and sys.argv[1] == "--import":
        import_from_files()
        check_sync()
    elif len(sys.argv) > 1 and sys.argv[1] == "--check":
        check_sync()
    else:
        print("Usage: python3 prompts_and_skills/sync.py [--check | --export | --import]")
        check_sync()

