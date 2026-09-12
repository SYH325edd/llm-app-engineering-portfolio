# Resume Center Validation

## Test Input

The validation script creates:

```text
runtime/test_resume.txt
```

The file contains:

```text
姓名：张三
电话：13800138000
邮箱：zhangsan@example.com
城市：杭州
学历：本科
学校：浙江大学
专业：计算机科学
技能：Python, FastAPI, PostgreSQL, Docker, AI视频
工作年限：3年
目标岗位：AI应用开发工程师
项目经历：参与AI视频生成平台开发，负责提示词优化和后端接口。
工作经历：曾在互联网公司担任后端开发工程师。
```

The script appends a validation batch id so each run creates a distinct resume hash.

## Test Flow

1. Create `runtime/test_resume.txt`.
2. Read text through `extract_text_from_file()`.
3. Parse structured fields through `parse_resume_text()`.
4. Generate Mock AI profile through `generate_resume_summary()`.
5. Generate rule score through `score_resume()`.
6. Simulate upload through `process_resume_upload()`.
7. Save file under `uploads/resumes/`.
8. Sync parsed resume into `candidates`.
9. Write `resume_center=true` audit log into `logs`.

## Database Write Result

Expected:

- `candidates` has one resume-related record with `raw_data.source = "resume"`.
- Resume metadata is stored under `raw_data.resume_center`.
- `logs` has at least one record with:

```json
{
  "resume_center": true,
  "action": "upload_resume",
  "source": "resume"
}
```

No schema change is required. If a future database does not support a dedicated source field, source is still recorded in `raw_data.source` and `logs.payload.source`.

## Page Validation Result

The Web Console pages added in step 36 were checked by HTTP:

- `/resumes`
- `/resumes/upload`

Both returned HTTP 200 during step 36 validation. This step validates the database and parsing chain through internal functions without browser upload.

## Passed Items

- Test resume file creation.
- Text extraction from TXT.
- Structured parsing for name, phone, email, city, education, and skills.
- Mock AI summary generation.
- Rule score in 0-100.
- Upload file save under `uploads/resumes/`.
- Candidate sync into `candidates`.
- Resume audit log write into `logs`.

## Failed Items

- None if `python test_resume_center.py` returns `PASSED`.

## Final Conclusion

Run:

```powershell
python -m py_compile resume_parser.py resume_center.py test_resume_center.py
python test_resume_center.py
```

Expected:

```text
PASSED
```
