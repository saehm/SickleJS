# Generate ground-truth Gabriel Classification Error values from DRquality.
#
#   Rscript tools/gce-reference.R
#
# Requires:
#   install.packages(c("DRquality", "DatabionicSwarm"))
# DatabionicSwarm compiles C++, so Windows needs Rtools.
#
# ## Why this is a black box, and why that is fine
#
# DRquality is GPL-3 and this library is not. Porting its source would make
# sickle a derivative work and force GPL-3 on the whole package. Running it to
# produce numbers does no such thing: the GPL covers distribution of the program
# and works derived from it, not the output of executing it, and measurements
# are facts rather than expression.
#
# So this script treats DRquality strictly as an oracle. It is never distributed,
# never imported, and never read for its implementation; only the JSON of
# expected values is committed, exactly as with the zadu and ScagnosticsJS
# fixtures. Matching observed behaviour is a clean-room reimplementation;
# transcribing source is not.

suppressPackageStartupMessages({
  ok <- requireNamespace("DRquality", quietly = TRUE) &&
        requireNamespace("DatabionicSwarm", quietly = TRUE)
})
if (!ok) {
  stop("Needs DRquality and DatabionicSwarm: install.packages(c('DRquality','DatabionicSwarm'))")
}

data_dir <- file.path("test", "fixtures", "data")
out_path <- file.path("test", "fixtures", "gce.json")

manifest <- jsonlite::fromJSON(file.path(data_dir, "manifest.json"))

results <- list()
for (i in seq_len(nrow(manifest))) {
  name <- manifest$name[i]

  X      <- as.matrix(read.csv(file.path(data_dir, paste0(name, ".X.csv")), header = FALSE))
  Y      <- as.matrix(read.csv(file.path(data_dir, paste0(name, ".Y.csv")), header = FALSE))
  labels <- as.numeric(readLines(file.path(data_dir, paste0(name, ".labels.csv"))))

  storage.mode(X) <- "numeric"
  storage.mode(Y) <- "numeric"

  res <- DRquality::GabrielClassificationError(
    Data = X, ProjectedPoints = Y, Cls = labels, PlotIt = FALSE
  )

  results[[name]] <- list(
    gce          = as.numeric(res$GCE),
    gce_perpoint = as.numeric(res$GCEperPoint),
    # Recorded because they determine the weighting and make a mismatch
    # diagnosable rather than merely visible.
    anz_nn       = as.numeric(res$AnzNN),
    nn           = as.numeric(res$nn)
  )

  cat(sprintf("  %-14s GCE = %.10f\n", name, results[[name]]$gce))
}

payload <- list(
  `_source`   = "DRquality (GPL-3), run as an oracle; only these values are committed",
  `_version`  = as.character(utils::packageVersion("DRquality")),
  fixtures    = results
)

writeLines(jsonlite::toJSON(payload, auto_unbox = TRUE, digits = 17, pretty = TRUE), out_path)
cat(sprintf("\nwrote %s\n", out_path))
