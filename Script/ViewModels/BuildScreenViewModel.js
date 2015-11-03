﻿var BuildScreenViewModel = function () {
    var self = this;

    function getNewDataModel() {
        var buildTypes = (function () {
            var isResultUpdate = false;
            var buildTypesFromApi = ko.observable({ isLoadingPlaceholder: true });

            var returnValue = ko.computed({
                read: function () {
                    if (!isResultUpdate) {
                        $.ajax({
                            dataType: "json",
                            url: Settings.buildTypesUrl,
                            xhrFields: { withCredentials: true },
                            success: function (data) {
                                try {
                                    isResultUpdate = true;
                                    buildTypesFromApi(data.buildType);
                                } finally {
                                    isResultUpdate = false;
                                }
                            }
                        });
                    }

                    return buildTypesFromApi().isLoadingPlaceholder ? buildTypesFromApi() : _(buildTypesFromApi()).map(function (buildTypeFromApi) {
                        buildTypeFromApi.branches = getBranchesForBuildTypeObservable(buildTypeFromApi);
                        return buildTypeFromApi;
                    });
                },
                deferEvaluation: true
            });

            returnValue.update = function() {
                buildTypesFromApi([]);
            };

            return returnValue;
        })();

        function getBranchesForBuildTypeObservable(buildType) {
            var branchesFromApi = ko.observable({ isLoadingPlaceholder: true });

            var isResultUpdate = false;
            return ko.computed({
                read: function () {
                    if (!isResultUpdate) {
                        $.ajax({
                            dataType: "json",
                            url: Settings.buildTypesUrl + '/id:(' + buildType.id + ')' + '/branches?' + Utils.getTsQSParam(),
                            xhrFields: { withCredentials: true },
                            success: function (data) {
                                try {
                                    isResultUpdate = true;
                                    var branches = [{ isNoBranchPlaceHolder: true }];
                                    branches = branches.concat(data.branch);
                                    branchesFromApi(branches);
                                } finally {
                                    isResultUpdate = false;
                                }
                            }
                        });
                    }

                    return branchesFromApi().isLoadingPlaceholder ? branchesFromApi() : _(branchesFromApi()).map(function (branchFromApi) {
                        branchFromApi.buildType = buildType;
                        branchFromApi.builds = getBuildsForBranchObservable(branchFromApi);
                        return branchFromApi;
                    });
                }
            });
        }

        function getBuildsForBranchObservable(branch) {
            var buildsFromApi = ko.observable({ isLoadingPlaceholder: true });

            var isResultUpdate = false;
            var builds = ko.computed({
                read: function () {
                    if (!isResultUpdate) {
                        $.ajax({
                            dataType: "json",
                            url: Settings.buildsUrl + ',buildType:(id:(' + branch.buildType.id + ')),branch(' + (branch.isNoBranchPlaceHolder ? 'branched:false' : ('name:' + branch.name)) + '),count:1' + Utils.getTsQSParam(),
                            xhrFields: { withCredentials: true },
                            success: function (data) {
                                try {
                                    isResultUpdate = true;
                                    buildsFromApi(data.build || []);
                                } finally {
                                    isResultUpdate = false;
                                }
                            }
                        });
                    }

                    return buildsFromApi().isLoadingPlaceholder ? buildsFromApi() : ko.utils.arrayMap(buildsFromApi(), function (build) {
                        return new SingleBuildViewModel(build, buildTypes());
                    });
                }
            });
            return builds;
        }

        var projects;

        var allBuildsOfAllProjectsOrLoadingPlaceholders = ko.computed({
            read: function () {
                return projects().isLoadingPlaceholder ? [projects()] : (_(projects()).chain()
                    .map(function (project) {
                        return project.buildTypes.isLoadingPlaceholder ? project.buildTypes : _(project.buildTypes).map(function (buildType) {
                            return buildType.branches().isLoadingPlaceholder ? buildType.branches() : _(buildType.branches()).map(function (branch) {
                                return branch.builds();
                            });
                        });
                    }).flatten().value());
            },
            deferEvaluation: true
        });
        return {
            projects: projects = ko.computed({
                read: function () {
                    return buildTypes().isLoadingPlaceholder ? buildTypes() : _(buildTypes()).chain().groupBy(function (buildType) {
                        return buildType.projectId;
                    }).mapObject(function (buildTypes, projectId) {
                        return {
                            projectId: projectId,
                            projectName: buildTypes[0].projectName,
                            buildTypes: buildTypes
                        };
                    })
                        .value()
                    ;
                },
                deferEvaluation: true
            }),
            allLoadedBuildsOfAllProjects: ko.computed({
                    read: function () {
                        return allBuildsOfAllProjectsOrLoadingPlaceholders().filter(function (build) { return !build.isLoadingPlaceholder; });
                    },
                    deferEvaluation: true
                }),
            isInitializing: ko.computed({
                read: function () {
                    return !!_(allBuildsOfAllProjectsOrLoadingPlaceholders()).findWhere({ isLoadingPlaceholder: true });
                },
                deferEvaluation: true
            })
        };
    };

    var currentViewDataModel = ko.observable(getNewDataModel());

    self.isFirstLoad = ko.computed(function() {
        return currentViewDataModel().isInitializing();
    });

    var buildFilterExcludeProperties = Utils.getObservableArrayBackedByStorage(/*storage:*/ window.localStorage, /*storageKey:*/ getAppStorageKey('buildFilterExcludeProperties'));
    var buildFilterExcludeFunctions = ko.computed(function () {
        return _(buildFilterExcludeProperties()).map(function(buildToExcludeProps) {
            return function(buildToTest) {
                return ((!buildToExcludeProps.branchName && !buildToTest.branchName) || (buildToTest.branchName && buildToTest.branchName() === buildToExcludeProps.branchName)) && buildToTest.buildTypeId() === buildToExcludeProps.buildTypeId;
            };
        });

    });

    self.excludedBuilds = {
        get length() { return buildFilterExcludeProperties().length },
        push: function (build) {
            buildFilterExcludeProperties.push({
                branchName: build.branchName && build.branchName(),
                buildTypeId: build.buildTypeId()
            });
        },
        removeAll: function () {
            buildFilterExcludeProperties.removeAll();
        }
    };

    self.builds = ko.computed({
        read: function () {
            return _(currentViewDataModel().allLoadedBuildsOfAllProjects()).filter(function (build) {
                return _(buildFilterExcludeFunctions()).any(function (shouldExclude) { return shouldExclude(build); }) === false;
            });
        },
        deferEvaluation: true
    });

    self.mainBuild = (function () {
        var isResultUpdate = false;
        var lastMainBuild = undefined;

        var mainBuildFromApi = ko.observable();
        var lastBuildId;

        ko.computed({
            read: function () {
                var url = null;
                if (Settings.mainBranch)
                    url = getBuildStatusUrlForBranch(Settings.mainBranch);
                else {
                    var buildId = self.builds().length && (ko.utils.arrayFirst(self.builds(), function (build) {
                            return build.status() === 'FAILURE';
                        }) || self.builds()[0]).id();
                    if (!self.isFirstLoad() && buildId && buildId !== lastBuildId) {
                        lastBuildId = buildId;
                        url = getBuildStatusUrlForBuildId(buildId);
                    }
                }

                if (url && !isResultUpdate) {
                    $.ajax({
                        dataType: "json",
                        url: url + '?' + Utils.getTsQSParam(),
                        xhrFields: { withCredentials: true },
                        success: function (data, status, xhr) {
                            try {
                                isResultUpdate = true;
                                if (lastMainBuild === xhr.responseText)
                                    return;
                                lastMainBuild = xhr.responseText;
                                mainBuildFromApi(ko.mapping.fromJS(data, {
                                    create: function (options) {
                                        return new MainBuildViewModel(options.data);
                                    }
                                }));
                            } finally {
                                isResultUpdate = false;
                            }
                        }
                    });
                }

                return mainBuildFromApi();
            }
        });
        return mainBuildFromApi;
    })();


    self.audio = {
        volume: Utils.getObservableBackedByStorage(window.localStorage, 'audio.volume', 1),
        isMuted: Utils.getObservableBackedByStorage(window.localStorage, 'audio.isMuted', false)
    };

    self.errorMessage = ko.observable();

    ko.computed(function () {
        if (!self.isFirstLoad() && self.builds().length === 0)
            self.errorMessage("There's no builds!? Better crack on with some work!");
        else
            self.errorMessage('');
    });

    self.randomClass = ko.observable(Utils.getRandomClass());

    self.hasError = ko.computed(function () {
        if (!this.errorMessage())
            return false;
        return this.errorMessage().length > 0;
    }, self);

    function update() {
        var newDataModel = getNewDataModel();
        newDataModel.isInitializing.subscribe(function (isInitializing) {
            if (!isInitializing) {
                currentViewDataModel(newDataModel);
                ensureAutoUpdate();
            }
        });
    }

    function ensureAutoUpdate() {
        if (Settings.enableAutoUpdate)
            setTimeout(update, Settings.checkIntervalMs);
    }

    self.init = function () {
        setInterval(function () { self.randomClass(Utils.getRandomClass()); }, Settings.buildImageIntervalMs);
        ensureAutoUpdate();
    };

    self.init();
};
