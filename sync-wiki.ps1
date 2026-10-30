param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$SourceDocx,
    [string]$WikiDir = $PSScriptRoot,
    [string]$ReportPath = (Join-Path (Get-Location) 'sync-review.md')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $SourceDocx -PathType Leaf)) {
    throw "DOCX file not found: $SourceDocx. Download or sync it using an account authorized for the SharePoint document."
}
if (-not (Test-Path -LiteralPath $WikiDir -PathType Container)) {
    throw "Wiki directory not found: $WikiDir"
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $SourceDocx).Path)
try {
    $documentEntry = $archive.GetEntry('word/document.xml')
    if ($null -eq $documentEntry) {
        throw 'The selected file is not a valid Word DOCX document (word/document.xml is missing).'
    }

    $documentStream = $documentEntry.Open()
    try {
        $document = New-Object System.Xml.XmlDocument
        $document.Load($documentStream)
    }
    finally {
        $documentStream.Dispose()
    }
}
finally {
    $archive.Dispose()
}

$namespaces = New-Object System.Xml.XmlNamespaceManager($document.NameTable)
$namespaces.AddNamespace('w', 'http://schemas.openxmlformats.org/wordprocessingml/2006/main')
$sourceParagraphs = @()

foreach ($paragraph in $document.SelectNodes('//w:body//w:p', $namespaces)) {
    $styleNode = $paragraph.SelectSingleNode('./w:pPr/w:pStyle', $namespaces)
    $style = if ($null -ne $styleNode) { $styleNode.GetAttribute('val', $namespaces.LookupNamespace('w')) } else { '' }
    $textParts = @()

    foreach ($node in $paragraph.SelectNodes('.//w:t | .//w:tab | .//w:br | .//w:cr', $namespaces)) {
        switch ($node.LocalName) {
            't' { $textParts += $node.InnerText }
            'tab' { $textParts += ' ' }
            { $_ -in 'br', 'cr' } { $textParts += ' ' }
        }
    }

    $text = [regex]::Replace(($textParts -join ''), '\s+', ' ').Trim()
    if ($text) {
        $sourceParagraphs += [pscustomobject]@{ Style = $style; Text = $text }
    }
}

$sections = New-Object System.Collections.ArrayList
$current = @{ Title = 'Document'; Paragraphs = (New-Object System.Collections.ArrayList) }
$sawHeading = $false

foreach ($paragraph in $sourceParagraphs) {
    $isHeading = $paragraph.Style -match '^heading\s*1$'
    $isTitle = $paragraph.Style -ieq 'title' -and -not $sawHeading

    if ($isHeading -or $isTitle) {
        if ($current.Paragraphs.Count -gt 0 -or $current.Title -ne 'Document') {
            [void]$sections.Add($current)
        }
        $current = @{ Title = $paragraph.Text; Paragraphs = (New-Object System.Collections.ArrayList) }
        $sawHeading = $true
    }
    else {
        [void]$current.Paragraphs.Add($paragraph.Text)
    }
}
if ($current.Paragraphs.Count -gt 0 -or $sections.Count -eq 0) {
    [void]$sections.Add($current)
}

function Normalize-Title([string]$Value) {
    $normalized = [regex]::Replace($Value, '\[[^\]]*(exclusive|mode)[^\]]*\]', '', 'IgnoreCase')
    $normalized = $normalized.Normalize([System.Text.NormalizationForm]::FormD)
    $normalized = [regex]::Replace($normalized, '\p{Mn}', '')
    return [regex]::Replace($normalized.ToLowerInvariant(), '[^\p{L}\p{Nd}]+', ' ').Trim()
}

function Get-PageText([string]$Path) {
    $html = [System.IO.File]::ReadAllText($Path)
    $headingMatch = [regex]::Match($html, '(?is)<h1\b[^>]*>(.*?)</h1>')
    $title = ''
    if ($headingMatch.Success) {
        $title = [regex]::Replace($headingMatch.Groups[1].Value, '<[^>]*>', '')
        $title = [System.Net.WebUtility]::HtmlDecode($title).Trim()
    }

    $content = [regex]::Replace($html, '(?is)<(header|nav|script|style)\b[^>]*>.*?</\1>', ' ')
    $content = [regex]::Replace($content, '(?i)<(?:br|p|h[1-6]|li|tr|td|th)\b[^>]*>', "`n")
    $content = [regex]::Replace($content, '(?i)</(?:p|h[1-6]|li|tr|td|th)\s*>', "`n")
    $content = [regex]::Replace($content, '<[^>]*>', ' ')
    $content = [System.Net.WebUtility]::HtmlDecode($content)
    $lines = @(
        $content -split '\r?\n' |
            ForEach-Object { [regex]::Replace($_, '\s+', ' ').Trim() } |
            Where-Object { $_ -and $_ -ne $title }
    )
    return [pscustomobject]@{ Title = $title; Lines = $lines }
}

$pageIndex = @{}
foreach ($page in Get-ChildItem -LiteralPath $WikiDir -Filter 'page-*.html' -File) {
    $pageText = Get-PageText $page.FullName
    if (-not $pageText.Title) {
        continue
    }
    $key = Normalize-Title $pageText.Title
    if (-not $pageIndex.ContainsKey($key)) {
        $pageIndex[$key] = New-Object System.Collections.ArrayList
    }
    [void]$pageIndex[$key].Add([pscustomobject]@{ Path = $page; Lines = $pageText.Lines })
}

$report = New-Object System.Collections.Generic.List[string]
$report.Add('# SharePoint DOCX sync review')
$report.Add('')
$report.Add("Source: ``$(Split-Path -Leaf $SourceDocx)``")
$report.Add('')
$report.Add('Review this report and edit wiki pages manually. This script never modifies or publishes wiki pages.')
$report.Add('')

foreach ($section in $sections) {
    $report.Add("## $($section.Title)")
    $report.Add('')
    $key = Normalize-Title $section.Title
    $matches = if ($pageIndex.ContainsKey($key)) { $pageIndex[$key] } else { @() }

    if ($matches.Count -eq 0) {
        $report.Add('**No matching wiki page found.** This may be a new article or a title that needs manual mapping.')
        $report.Add('')
        foreach ($paragraph in $section.Paragraphs) {
            $report.Add("- $paragraph")
        }
        $report.Add('')
        continue
    }

    if ($matches.Count -gt 1) {
        $pageNames = ($matches | ForEach-Object { "``$($_.Path.Name)``" }) -join ', '
        $report.Add("**Multiple pages match:** $pageNames")
        $report.Add('')
        continue
    }

    $target = $matches[0]
    $sourceLines = @($section.Paragraphs)
    $wikiLines = @($target.Lines)
    $report.Add("Matched page: ``$($target.Path.Name)``")
    $report.Add('')

    if (($wikiLines -join "`n") -ceq ($sourceLines -join "`n")) {
        $report.Add('No text differences detected.')
        $report.Add('')
        continue
    }

    $report.Add('### Current wiki text')
    $report.Add('')
    $report.Add('```text')
    foreach ($line in $wikiLines) { $report.Add($line) }
    $report.Add('```')
    $report.Add('')
    $report.Add('### SharePoint text')
    $report.Add('')
    $report.Add('```text')
    foreach ($line in $sourceLines) { $report.Add($line) }
    $report.Add('```')
    $report.Add('')
}

$reportFullPath = [System.IO.Path]::GetFullPath($ReportPath)
$reportDirectory = Split-Path -Parent $reportFullPath
if ($reportDirectory -and -not (Test-Path -LiteralPath $reportDirectory -PathType Container)) {
    New-Item -ItemType Directory -Path $reportDirectory -Force | Out-Null
}
[System.IO.File]::WriteAllLines($reportFullPath, $report.ToArray(), [System.Text.UTF8Encoding]::new($false))
Write-Output "Review report written to $reportFullPath"
Write-Output "Extracted $($sourceParagraphs.Count) paragraphs across $($sections.Count) sections."
